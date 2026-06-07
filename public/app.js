const state = {
  username: null,
  ws: null,
  currentGame: null,
  pendingChallenges: [],
};

const elements = {
  username: document.getElementById('username'),
  registerBtn: document.getElementById('register-btn'),
  authStatus: document.getElementById('auth-status'),
  playPanel: document.getElementById('play-panel'),
  gamePanel: document.getElementById('game-panel'),
  challengePanel: document.getElementById('challenge-panel'),
  leaderboardPanel: document.getElementById('leaderboard-panel'),
  historyPanel: document.getElementById('history-panel'),
  mode: document.getElementById('mode'),
  letterCount: document.getElementById('letter-count'),
  opponent: document.getElementById('opponent'),
  assignedWord: document.getElementById('assigned-word'),
  hint: document.getElementById('hint'),
  startBtn: document.getElementById('start-btn'),
  gameMeta: document.getElementById('game-meta'),
  board: document.getElementById('board'),
  guess: document.getElementById('guess'),
  guessBtn: document.getElementById('guess-btn'),
  hintBox: document.getElementById('hint-box'),
  challengeList: document.getElementById('challenge-list'),
  userOptions: document.getElementById('user-options'),
  leaderboardMode: document.getElementById('leaderboard-mode'),
  refreshLeaderboard: document.getElementById('refresh-leaderboard'),
  leaderboardBody: document.getElementById('leaderboard-body'),
  historyList: document.getElementById('history-list'),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function showAppPanels() {
  elements.playPanel.classList.remove('hidden');
  elements.gamePanel.classList.remove('hidden');
  elements.challengePanel.classList.remove('hidden');
  elements.leaderboardPanel.classList.remove('hidden');
  elements.historyPanel.classList.remove('hidden');
}

function connectSocket() {
  if (state.ws) {
    state.ws.close();
  }

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${location.host}?username=${encodeURIComponent(state.username)}`);

  state.ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === 'connected') {
      state.pendingChallenges = payload.challenges || [];
      renderChallenges();
      if (!state.currentGame && payload.activeGames?.length) {
        state.currentGame = payload.activeGames[0];
        renderGame();
      }
      return;
    }

    if (payload.type === 'challenge_pending') {
      state.pendingChallenges.unshift(payload.challenge);
      renderChallenges();
      return;
    }

    if (payload.type === 'game_update') {
      if (state.currentGame?.id === payload.game.id) {
        state.currentGame = payload.game;
        renderGame();
      }
      loadHistory();
      loadLeaderboard();
    }
  };
}

function makeTile(letter, status, width) {
  const div = document.createElement('div');
  div.className = `tile ${status || ''}`;
  div.textContent = letter || '';
  div.style.gridColumn = `span ${Math.max(1, Math.floor(8 / width))}`;
  return div;
}

function renderGame() {
  const game = state.currentGame;
  if (!game) {
    elements.gameMeta.textContent = 'No active game.';
    elements.board.innerHTML = '';
    elements.hintBox.textContent = '';
    return;
  }

  const me = game.perPlayer[state.username];
  const opponent = game.players.find((p) => p !== state.username);
  elements.gameMeta.textContent = `${game.mode} • ${game.status} • ${game.letterCount} letters${opponent ? ` vs ${opponent}` : ''}`;

  if ((game.mode === 'head-to-head' || game.mode === 'blind') && me?.hint) {
    elements.hintBox.textContent = `Hint from opponent: ${me.hint}`;
  } else {
    elements.hintBox.textContent = '';
  }

  elements.board.innerHTML = '';

  const guesses = me?.guesses || [];
  for (const entry of guesses) {
    const row = document.createElement('div');
    row.className = 'guess-row';

    for (let i = 0; i < game.letterCount; i += 1) {
      row.appendChild(makeTile(entry.guess[i], entry.result[i], game.letterCount));
    }
    elements.board.appendChild(row);
  }

  const statusText = document.createElement('p');
  if (game.status !== 'active') {
    const winnerLabel = game.winner ? ` Winner: ${game.winner}.` : '';
    statusText.textContent = `Game ended.${winnerLabel}`;
  } else if (me?.solved) {
    statusText.textContent = 'Solved! Waiting for game completion...';
  }
  elements.board.appendChild(statusText);
}

function renderChallenges() {
  elements.challengeList.innerHTML = '';
  if (!state.pendingChallenges.length) {
    elements.challengeList.textContent = 'No pending challenges.';
    return;
  }

  for (const challenge of state.pendingChallenges) {
    const container = document.createElement('div');
    container.className = 'challenge-item';
    container.innerHTML = `
      <strong>${challenge.from}</strong> challenged you to ${challenge.mode} (${challenge.letterCount} letters)
      ${challenge.hint ? `<div>Hint: ${challenge.hint}</div>` : ''}
      <input placeholder="Assign your return word" maxlength="8" data-word="${challenge.id}" />
      <input placeholder="Optional hint/category" maxlength="100" data-hint="${challenge.id}" />
      <div class="row">
        <button data-accept="${challenge.id}">Accept</button>
        <button class="danger" data-reject="${challenge.id}">Reject</button>
      </div>
    `;
    elements.challengeList.appendChild(container);
  }
}

async function loadUsers() {
  const query = elements.opponent.value.trim();
  const data = await api(`/api/users?query=${encodeURIComponent(query)}`);
  elements.userOptions.innerHTML = data.users.map((u) => `<option value="${u.username}"></option>`).join('');
}

async function loadLeaderboard() {
  if (!state.username) return;
  const mode = elements.leaderboardMode.value;
  const data = await api(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);

  elements.leaderboardBody.innerHTML = data.leaderboard
    .map((entry) => `<tr><td>${entry.username}</td><td>${entry.points}</td><td>${entry.wins}</td><td>${entry.games}</td></tr>`)
    .join('');
}

async function loadHistory() {
  if (!state.username) return;
  const data = await api(`/api/history/${encodeURIComponent(state.username)}`);
  elements.historyList.innerHTML = data.games
    .slice(0, 12)
    .map((game) => `${game.mode} • ${game.status} • guesses: ${game.guesses} ${game.opponent ? `• vs ${game.opponent}` : ''}`)
    .map((line) => `<div>${line}</div>`)
    .join('');
}

elements.registerBtn.addEventListener('click', async () => {
  try {
    const username = elements.username.value.trim();
    await api('/api/register', { method: 'POST', body: JSON.stringify({ username }) });

    state.username = username;
    elements.authStatus.textContent = `Logged in as ${username}`;
    showAppPanels();
    connectSocket();
    loadLeaderboard();
    loadHistory();
    loadUsers();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
});

elements.opponent.addEventListener('input', () => {
  loadUsers().catch(() => {});
});

async function startOrChallenge() {
  const mode = elements.mode.value;
  const letterCount = Number(elements.letterCount.value);
  const opponent = elements.opponent.value.trim();
  const assignedWord = elements.assignedWord.value.trim().toLowerCase();
  const hint = elements.hint.value.trim();

  try {
    if (mode === 'head-to-head' || mode === 'blind') {
      await api('/api/challenge/create', {
        method: 'POST',
        body: JSON.stringify({ mode, from: state.username, to: opponent, letterCount, assignedWord, hint }),
      });
      elements.gameMeta.textContent = `Challenge sent to ${opponent}`;
      return;
    }

    const data = await api('/api/game/start', {
      method: 'POST',
      body: JSON.stringify({ mode, username: state.username, opponent, letterCount }),
    });
    state.currentGame = data.game;
    renderGame();
    loadHistory();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
}

elements.startBtn.addEventListener('click', () => {
  startOrChallenge();
});

elements.guessBtn.addEventListener('click', async () => {
  if (!state.currentGame) return;

  try {
    const guess = elements.guess.value.trim().toLowerCase();
    const data = await api('/api/game/guess', {
      method: 'POST',
      body: JSON.stringify({ gameId: state.currentGame.id, username: state.username, guess }),
    });

    state.currentGame = data.game;
    elements.guess.value = '';
    renderGame();
    loadLeaderboard();
    loadHistory();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
});

elements.challengeList.addEventListener('click', async (event) => {
  const acceptId = event.target.getAttribute('data-accept');
  const rejectId = event.target.getAttribute('data-reject');
  if (!acceptId && !rejectId) return;

  const challengeId = acceptId || rejectId;

  try {
    if (acceptId) {
      const assignedWordBack = document.querySelector(`input[data-word="${challengeId}"]`)?.value?.trim()?.toLowerCase();
      const hintBack = document.querySelector(`input[data-hint="${challengeId}"]`)?.value?.trim() || '';
      const data = await api('/api/challenge/respond', {
        method: 'POST',
        body: JSON.stringify({ challengeId, username: state.username, accept: true, assignedWordBack, hintBack }),
      });
      state.currentGame = data.game;
    } else {
      await api('/api/challenge/respond', {
        method: 'POST',
        body: JSON.stringify({ challengeId, username: state.username, accept: false }),
      });
    }

    state.pendingChallenges = state.pendingChallenges.filter((c) => c.id !== challengeId);
    renderChallenges();
    renderGame();
    loadHistory();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
});

elements.refreshLeaderboard.addEventListener('click', () => loadLeaderboard());
elements.leaderboardMode.addEventListener('change', () => loadLeaderboard());
