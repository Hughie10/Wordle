const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const {
  clampLetterCount,
  evaluateGuess,
  getDailyKey,
  makeId,
  normalizeWord,
  pickDailyWord,
  pickRandomWord,
} = require('./src/game');
const { JsonlStore } = require('./src/storage');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || '/data';
const WORD_LIST_PATH = process.env.WORD_LIST_PATH || path.join(__dirname, 'config', 'words.json');

const words = JSON.parse(fs.readFileSync(WORD_LIST_PATH, 'utf8')).map(normalizeWord);
const wordSet = new Set(words);
const app = express();
const store = new JsonlStore(DATA_DIR);
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const socketsByUser = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanUsername(username) {
  const value = String(username || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(value)) {
    throw new Error('Username must be 3-20 chars and contain only letters, numbers, _ or -');
  }
  return value;
}

function requireUser(username) {
  const user = store.getUser(username);
  if (!user) {
    throw new Error('Unknown user. Please register first.');
  }
  return user;
}

function nowIso() {
  return new Date().toISOString();
}

function makePlayerState(targetWord, hint) {
  return {
    guesses: [],
    solved: false,
    solvedAt: null,
    targetWord,
    hint: hint || null,
  };
}

function scoreTemplate(username) {
  return {
    username,
    overall: { games: 0, wins: 0, points: 0 },
    modes: {},
    vs: {},
    updatedAt: nowIso(),
  };
}

function ensureModeScore(score, mode) {
  if (!score.modes[mode]) {
    score.modes[mode] = { games: 0, wins: 0, points: 0 };
  }
  return score.modes[mode];
}

function ensureVsScore(score, opponent) {
  if (!score.vs[opponent]) {
    score.vs[opponent] = { games: 0, wins: 0, losses: 0, points: 0 };
  }
  return score.vs[opponent];
}

function saveScoreDelta({ username, mode, points = 0, won = false, opponent = null }) {
  if (mode === 'solo') {
    return;
  }

  const score = store.getScore(username) || scoreTemplate(username);
  const modeScore = ensureModeScore(score, mode);

  score.overall.games += 1;
  modeScore.games += 1;

  if (won) {
    score.overall.wins += 1;
    modeScore.wins += 1;
  }

  score.overall.points += points;
  modeScore.points += points;

  if (opponent) {
    const vsScore = ensureVsScore(score, opponent);
    vsScore.games += 1;
    vsScore.points += points;
    if (won) {
      vsScore.wins += 1;
    } else {
      vsScore.losses += 1;
    }
  }

  score.updatedAt = nowIso();
  store.saveScore(score);
}

function emitToUser(username, payload) {
  const sockets = socketsByUser.get(username);
  if (!sockets) {
    return;
  }

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

function emitGameUpdate(game) {
  for (const player of game.players) {
    emitToUser(player, { type: 'game_update', game });
  }
}

function finishVersusGame(game) {
  const players = game.players;
  const [a, b] = players;
  const stateA = game.perPlayer[a];
  const stateB = game.perPlayer[b];

  if (!stateA.solved || !stateB.solved) {
    return null;
  }

  const guessesA = stateA.guesses.length;
  const guessesB = stateB.guesses.length;

  if (guessesA < guessesB) {
    return a;
  }
  if (guessesB < guessesA) {
    return b;
  }

  return stateA.solvedAt <= stateB.solvedAt ? a : b;
}

function finalizeGame(game, reason = 'completed') {
  if (game.status === 'completed' || game.status === 'expired') {
    return game;
  }

  game.completedAt = nowIso();
  game.status = reason === 'expired' ? 'expired' : 'completed';

  if (game.mode === 'quick-fire') {
    const winner = game.winner || finishVersusGame(game);
    game.winner = winner || null;

    for (const player of game.players) {
      const isWinner = winner === player;
      saveScoreDelta({
        username: player,
        mode: game.mode,
        points: isWinner ? 12 : 3,
        won: isWinner,
        opponent: game.players.find((name) => name !== player),
      });
    }
  } else if (game.mode === 'head-to-head' || game.mode === 'blind') {
    const winner = finishVersusGame(game);
    game.winner = winner || null;

    for (const player of game.players) {
      const isWinner = winner === player;
      saveScoreDelta({
        username: player,
        mode: game.mode,
        points: isWinner ? 10 : 4,
        won: isWinner,
        opponent: game.players.find((name) => name !== player),
      });
    }
  } else if (game.mode === 'daily') {
    for (const player of game.players) {
      const playerState = game.perPlayer[player];
      if (!playerState.solved) {
        continue;
      }
      const points = Math.max(2, 12 - playerState.guesses.length);
      saveScoreDelta({ username: player, mode: game.mode, points, won: playerState.guesses.length <= 3 });
    }
  } else if (game.mode === 'survival') {
    const player = game.players[0];
    saveScoreDelta({ username: player, mode: game.mode, points: game.metadata.streak * 2, won: game.metadata.streak > 0 });
  }

  store.saveGame(game);
  emitGameUpdate(game);
  return game;
}

function createBaseGame(mode, letterCount, players, expiresAt = null) {
  return {
    id: makeId(mode),
    mode,
    letterCount,
    players,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    expiresAt,
    winner: null,
    perPlayer: {},
    metadata: {},
  };
}

function createSoloGame(username, letterCount) {
  const game = createBaseGame('solo', letterCount, [username]);
  game.secretWord = pickRandomWord(words, letterCount);
  game.perPlayer[username] = makePlayerState(game.secretWord);
  return store.saveGame(game);
}

function createQuickFireGame(username, opponent, letterCount, timeoutMinutes = 5) {
  const word = pickRandomWord(words, letterCount);
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();
  const game = createBaseGame('quick-fire', letterCount, [username, opponent], expiresAt);
  game.secretWord = word;
  game.perPlayer[username] = makePlayerState(word);
  game.perPlayer[opponent] = makePlayerState(word);
  game.metadata.timeoutMinutes = timeoutMinutes;
  store.saveGame(game);
  emitGameUpdate(game);
  return game;
}

function createDailyGame(username, letterCount) {
  const key = getDailyKey();
  const id = `daily-${key}-${letterCount}`;
  let game = store.getGame(id);
  if (!game) {
    const word = pickDailyWord(words, key, letterCount);
    game = {
      ...createBaseGame('daily', letterCount, []),
      id,
      secretWord: word,
      expiresAt: new Date(`${key}T23:59:59.999Z`).toISOString(),
      metadata: { dailyKey: key },
    };
  }

  if (!game.players.includes(username)) {
    game.players.push(username);
    game.perPlayer[username] = makePlayerState(game.secretWord);
  }

  game.updatedAt = nowIso();
  store.saveGame(game);
  return game;
}

function createSurvivalGame(username, letterCount) {
  const game = createBaseGame('survival', letterCount, [username]);
  game.metadata.streak = 0;
  game.metadata.level = letterCount;
  game.metadata.currentWord = pickRandomWord(words, letterCount);
  game.perPlayer[username] = {
    ...makePlayerState(game.metadata.currentWord),
    rounds: [],
  };

  return store.saveGame(game);
}

function createChallenge({ mode, from, to, letterCount, assignedWord, hint }) {
  const challenge = {
    id: makeId('challenge'),
    mode,
    from,
    to,
    letterCount,
    assignedWord,
    hint: hint || null,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    gameId: null,
  };

  store.saveChallenge(challenge);
  emitToUser(to, { type: 'challenge_pending', challenge });
  return challenge;
}

function acceptChallenge(challenge, responderWord, responderHint) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const game = createBaseGame(challenge.mode, challenge.letterCount, [challenge.from, challenge.to], expiresAt);

  game.perPlayer[challenge.from] = makePlayerState(responderWord, responderHint);
  game.perPlayer[challenge.to] = makePlayerState(challenge.assignedWord, challenge.hint);
  game.metadata.challengeId = challenge.id;

  challenge.status = 'accepted';
  challenge.updatedAt = nowIso();
  challenge.gameId = game.id;

  store.saveChallenge(challenge);
  store.saveGame(game);
  emitGameUpdate(game);
  emitToUser(challenge.from, { type: 'challenge_accepted', challenge, game });
  return game;
}

function serializeForPlayer(game, username) {
  const payload = { ...game, perPlayer: { ...game.perPlayer } };

  if (game.mode === 'quick-fire' || game.mode === 'solo' || game.mode === 'daily' || game.mode === 'survival') {
    payload.secretWord = game.status === 'active' ? null : game.secretWord;
  }

  if (game.mode === 'head-to-head' || game.mode === 'blind') {
    for (const player of game.players) {
      if (player !== username) {
        payload.perPlayer[player] = {
          ...payload.perPlayer[player],
          targetWord: game.status === 'active' ? null : payload.perPlayer[player].targetWord,
        };
      }
    }
  }

  return payload;
}

function rejectIfExpired(game) {
  if (game.status !== 'active' || !game.expiresAt) {
    return false;
  }

  if (new Date(game.expiresAt).getTime() <= Date.now()) {
    finalizeGame(game, 'expired');
    return true;
  }

  return false;
}

function applyGuess(game, username, guess) {
  rejectIfExpired(game);

  if (game.status !== 'active') {
    throw new Error('Game is not active');
  }

  if (!game.players.includes(username)) {
    throw new Error('You are not a player in this game');
  }

  const playerState = game.perPlayer[username];
  const normalized = normalizeWord(guess);
  if (normalized.length !== game.letterCount) {
    throw new Error(`Guess must be ${game.letterCount} letters`);
  }
  if (!/^[a-z]+$/.test(normalized)) {
    throw new Error('Guess must contain only letters');
  }

  let targetWord = game.secretWord;
  if (game.mode === 'head-to-head' || game.mode === 'blind') {
    targetWord = playerState.targetWord;
  }
  if (game.mode === 'survival') {
    targetWord = game.metadata.currentWord;
  }

  const result = evaluateGuess(targetWord, normalized);
  const solved = normalized === targetWord;
  playerState.guesses.push({ guess: normalized, result, solved, at: nowIso() });

  if (solved) {
    playerState.solved = true;
    playerState.solvedAt = nowIso();

    if (game.mode === 'quick-fire') {
      game.winner = username;
      finalizeGame(game);
    } else if (game.mode === 'solo') {
      finalizeGame(game);
    } else if (game.mode === 'daily') {
      const everyoneDone = game.players.every((player) => game.perPlayer[player].solved);
      if (everyoneDone || new Date(game.expiresAt).getTime() <= Date.now()) {
        finalizeGame(game);
      }
    } else if (game.mode === 'head-to-head' || game.mode === 'blind') {
      const everyoneDone = game.players.every((player) => game.perPlayer[player].solved);
      if (everyoneDone) {
        finalizeGame(game);
      }
    } else if (game.mode === 'survival') {
      game.metadata.streak += 1;
      const nextLevel = Math.min(8, game.metadata.level + 1);
      playerState.rounds.push({
        level: game.metadata.level,
        guesses: playerState.guesses.length,
        solvedAt: playerState.solvedAt,
      });

      game.metadata.level = nextLevel;
      game.letterCount = nextLevel;
      game.metadata.currentWord = pickRandomWord(words, nextLevel);
      game.secretWord = game.metadata.currentWord;
      game.perPlayer[username] = {
        ...makePlayerState(game.metadata.currentWord),
        rounds: playerState.rounds,
      };
    }
  } else if (playerState.guesses.length >= 6) {
    if (game.mode === 'survival') {
      finalizeGame(game);
    }
  }

  game.updatedAt = nowIso();
  store.saveGame(game);
  emitGameUpdate(game);

  return {
    result,
    solved,
    status: game.status,
    game: serializeForPlayer(game, username),
  };
}

function gameSummary(game, username) {
  const me = game.perPlayer[username];
  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    createdAt: game.createdAt,
    completedAt: game.completedAt,
    opponent: game.players.find((player) => player !== username) || null,
    guesses: me ? me.guesses.length : 0,
    solved: me ? me.solved : false,
    winner: game.winner,
  };
}

app.post('/api/register', (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const existing = store.getUser(username);

    const user = {
      username,
      createdAt: existing ? existing.createdAt : nowIso(),
      lastSeenAt: nowIso(),
    };

    store.saveUser(user);
    res.json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/users', (req, res) => {
  const query = String(req.query.query || '');
  const users = store.listUsers(query).slice(0, 20);
  res.json({ users });
});

app.post('/api/game/start', (req, res) => {
  try {
    const mode = String(req.body.mode || 'solo');
    const username = cleanUsername(req.body.username);
    requireUser(username);

    const letterCount = clampLetterCount(req.body.letterCount);
    let game;

    if (mode === 'solo') {
      game = createSoloGame(username, letterCount);
    } else if (mode === 'quick-fire') {
      const opponent = cleanUsername(req.body.opponent);
      if (opponent === username) {
        throw new Error('Choose a different opponent');
      }
      requireUser(opponent);
      game = createQuickFireGame(username, opponent, letterCount, Number.parseInt(req.body.timeoutMinutes || '5', 10));
    } else if (mode === 'daily') {
      game = createDailyGame(username, letterCount);
    } else if (mode === 'survival') {
      game = createSurvivalGame(username, letterCount);
    } else {
      throw new Error('Use challenge API for head-to-head and blind modes');
    }

    res.json({ game: serializeForPlayer(game, username) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/challenge/create', (req, res) => {
  try {
    const mode = String(req.body.mode || 'head-to-head');
    if (mode !== 'head-to-head' && mode !== 'blind') {
      throw new Error('Challenge mode must be head-to-head or blind');
    }

    const from = cleanUsername(req.body.from);
    const to = cleanUsername(req.body.to);
    if (from === to) {
      throw new Error('Choose a different opponent');
    }

    requireUser(from);
    requireUser(to);

    const letterCount = clampLetterCount(req.body.letterCount);
    const assignedWord = normalizeWord(req.body.assignedWord);
    if (assignedWord.length !== letterCount || !wordSet.has(assignedWord)) {
      throw new Error(`Assigned word must be in local dictionary with ${letterCount} letters`);
    }

    const hint = String(req.body.hint || '').trim();
    const challenge = createChallenge({ mode, from, to, letterCount, assignedWord, hint });

    res.json({ challenge });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/challenge/respond', (req, res) => {
  try {
    const challengeId = String(req.body.challengeId || '');
    const challenge = store.getChallenge(challengeId);
    if (!challenge) {
      throw new Error('Challenge not found');
    }

    const username = cleanUsername(req.body.username);
    if (challenge.to !== username) {
      throw new Error('Only challenged user can respond');
    }

    const accept = Boolean(req.body.accept);
    if (!accept) {
      challenge.status = 'rejected';
      challenge.updatedAt = nowIso();
      store.saveChallenge(challenge);
      emitToUser(challenge.from, { type: 'challenge_rejected', challenge });
      return res.json({ challenge });
    }

    const assignedWordBack = normalizeWord(req.body.assignedWordBack);
    if (assignedWordBack.length !== challenge.letterCount || !wordSet.has(assignedWordBack)) {
      throw new Error(`You must assign a valid ${challenge.letterCount}-letter dictionary word`);
    }

    const hintBack = String(req.body.hintBack || '').trim();
    const game = acceptChallenge(challenge, assignedWordBack, hintBack);

    res.json({ challenge, game: serializeForPlayer(game, username) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/challenges/:username', (req, res) => {
  try {
    const username = cleanUsername(req.params.username);
    requireUser(username);
    const incoming = store.listChallengesForUser(username);
    const outgoing = store.listOutgoingChallengesForUser(username);
    const activeGames = store
      .listGamesByUser(username)
      .filter((game) => game.status === 'active' && game.mode !== 'solo' && game.mode !== 'daily');

    res.json({ challenges: incoming, incoming, outgoing, activeGames });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/game/guess', (req, res) => {
  try {
    const game = store.getGame(String(req.body.gameId || ''));
    if (!game) {
      throw new Error('Game not found');
    }

    const username = cleanUsername(req.body.username);
    const result = applyGuess(game, username, req.body.guess);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/game/:id', (req, res) => {
  try {
    const username = cleanUsername(req.query.username);
    requireUser(username);
    const game = store.getGame(String(req.params.id || ''));
    if (!game) {
      throw new Error('Game not found');
    }

    rejectIfExpired(game);
    res.json({ game: serializeForPlayer(game, username) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/leaderboard', (req, res) => {
  const mode = String(req.query.mode || 'overall');
  const scores = store.listScores();
  const board = scores
    .map((score) => {
      if (mode === 'overall') {
        return {
          username: score.username,
          games: score.overall.games,
          wins: score.overall.wins,
          points: score.overall.points,
        };
      }
      const modeScore = score.modes[mode] || { games: 0, wins: 0, points: 0 };
      return {
        username: score.username,
        games: modeScore.games,
        wins: modeScore.wins,
        points: modeScore.points,
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.username.localeCompare(b.username))
    .slice(0, 50);

  res.json({ mode, leaderboard: board });
});

app.get('/api/history/:username', (req, res) => {
  try {
    const username = cleanUsername(req.params.username);
    requireUser(username);
    const opponentFilter = req.query.opponent ? cleanUsername(req.query.opponent) : null;

    const games = store
      .listGamesByUser(username)
      .filter((game) => (opponentFilter ? game.players.includes(opponentFilter) : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const summary = games.map((game) => gameSummary(game, username));
    const score = store.getScore(username) || scoreTemplate(username);

    res.json({
      games: summary,
      opponentStats: opponentFilter ? score.vs[opponentFilter] || { games: 0, wins: 0, losses: 0, points: 0 } : null,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const username = requestUrl.searchParams.get('username');

  if (!username || !store.getUser(username)) {
    ws.close(1008, 'Register first');
    return;
  }

  const current = socketsByUser.get(username) || new Set();
  current.add(ws);
  socketsByUser.set(username, current);

  ws.send(
    JSON.stringify({
      type: 'connected',
      username,
      challenges: store.listChallengesForUser(username),
      activeGames: store.listGamesByUser(username).filter((game) => game.status === 'active').map((game) => serializeForPlayer(game, username)),
    }),
  );

  ws.on('close', () => {
    const sockets = socketsByUser.get(username);
    if (!sockets) {
      return;
    }
    sockets.delete(ws);
    if (!sockets.size) {
      socketsByUser.delete(username);
    }
  });
});

setInterval(() => {
  for (const game of store.games.values()) {
    if (game.status === 'active' && game.expiresAt && new Date(game.expiresAt).getTime() <= Date.now()) {
      finalizeGame(game, 'expired');
    }
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`Wordle server running on http://localhost:${PORT}`);
  console.log(`Persisting JSONL data in ${DATA_DIR}`);
});
