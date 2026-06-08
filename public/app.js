const MODES = [
  { id: 'quick-fire', label: 'Quick Fire', type: 'realtime' },
  { id: 'daily', label: 'Daily Challenge', type: 'nonrealtime' },
  { id: 'head-to-head', label: 'Head-to-Head', type: 'nonrealtime' },
  { id: 'survival', label: 'Survival Mode', type: 'realtime' },
  { id: 'blind', label: 'Blind Challenge', type: 'nonrealtime' },
  { id: 'solo', label: 'Solo Mode', type: 'solo' },
];
const KEYBOARD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
];
const KEY_STATUS_ORDER = { unused: 0, absent: 1, present: 2, correct: 3 };

const state = {
  username: null,
  loggedIn: false,
  ws: null,
  currentGame: null,
  selectedMode: null,
  challengeData: { incoming: [], outgoing: [], activeGames: [] },
  loadingChallenges: false,
};

const elements = {
  authToggleBtn: document.getElementById('auth-toggle-btn'),
  authPanel: document.getElementById('auth-panel'),
  username: document.getElementById('username'),
  registerBtn: document.getElementById('register-btn'),
  authStatus: document.getElementById('auth-status'),
  modeSidebar: document.getElementById('mode-sidebar'),
  modeCards: document.getElementById('mode-cards'),
  modePanel: document.getElementById('mode-panel'),
  modePanelTitle: document.getElementById('mode-panel-title'),
  modeHelpText: document.getElementById('mode-help-text'),
  modeStatus: document.getElementById('mode-status'),
  modeSections: document.getElementById('mode-sections'),
  challengeBtn: document.getElementById('challenge-btn'),
  challengeFields: document.getElementById('challenge-fields'),
  opponent: document.getElementById('opponent'),
  assignedWord: document.getElementById('assigned-word'),
  hint: document.getElementById('hint'),
  userOptions: document.getElementById('user-options'),
  letterCount: document.getElementById('letter-count'),
  startSoloBtn: document.getElementById('start-solo-btn'),
  gameMeta: document.getElementById('game-meta'),
  board: document.getElementById('board'),
  hintBox: document.getElementById('hint-box'),
  guess: document.getElementById('guess'),
  guessBtn: document.getElementById('guess-btn'),
  keyboard: document.getElementById('keyboard'),
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

function setModeStatus(message = '') {
  elements.modeStatus.textContent = message;
}

function makeTile(letter, status, width) {
  const div = document.createElement('div');
  div.className = `tile ${status || ''}`;
  div.textContent = letter || '';
  div.style.gridColumn = `span ${Math.max(1, Math.floor(8 / width))}`;
  return div;
}

function getLetterStates(game, playerState) {
  const states = {};
  for (const row of KEYBOARD_ROWS) {
    for (const key of row) {
      if (key.length === 1) {
        states[key] = 'unused';
      }
    }
  }

  const guesses = playerState?.guesses || [];
  for (const entry of guesses) {
    for (let i = 0; i < entry.guess.length; i += 1) {
      const letter = entry.guess[i];
      const next = entry.result[i] || 'unused';
      const current = states[letter] || 'unused';
      if (KEY_STATUS_ORDER[next] > KEY_STATUS_ORDER[current]) {
        states[letter] = next;
      }
    }
  }

  return states;
}

function makeKeyButton(key, letterStates) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key';
  button.dataset.key = key;

  if (key === 'enter') {
    button.classList.add('wide');
    button.textContent = 'Enter';
    return button;
  }
  if (key === 'backspace') {
    button.classList.add('wide');
    button.textContent = '⌫';
    return button;
  }

  button.classList.add(letterStates[key] || 'unused');
  button.textContent = key.toUpperCase();
  return button;
}

function renderKeyboard(game, playerState) {
  const letterStates = getLetterStates(game, playerState);
  elements.keyboard.innerHTML = '';
  for (const rowLetters of KEYBOARD_ROWS) {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    for (const key of rowLetters) {
      row.appendChild(makeKeyButton(key, letterStates));
    }
    elements.keyboard.appendChild(row);
  }
}

function renderGame() {
  const game = state.currentGame;
  if (!game) {
    elements.gameMeta.textContent = 'Loading game...';
    elements.board.innerHTML = '';
    elements.hintBox.textContent = '';
    elements.keyboard.innerHTML = '';
    return;
  }

  const me = game.perPlayer[state.username];
  const opponent = game.players.find((player) => player !== state.username);
  elements.gameMeta.textContent = `${game.mode} • ${game.status} • ${game.letterCount} letters${opponent ? ` vs ${opponent}` : ''}`;
  elements.hintBox.textContent = (game.mode === 'head-to-head' || game.mode === 'blind') && me?.hint
    ? `Hint from opponent: ${me.hint}`
    : '';

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
    statusText.textContent = `Game ended.${game.winner ? ` Winner: ${game.winner}.` : ''}`;
  } else if (me?.solved) {
    statusText.textContent = 'Solved! Waiting for game completion...';
  }
  elements.board.appendChild(statusText);
  elements.guess.maxLength = game.letterCount;
  renderKeyboard(game, me);
}

function createSection(title, items, emptyText, itemRenderer) {
  const section = document.createElement('section');
  section.className = 'mode-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = emptyText;
    section.appendChild(empty);
    return section;
  }

  for (const item of items) {
    section.appendChild(itemRenderer(item));
  }
  return section;
}

function challengeItem(challenge, includeRespondActions = false, modeId = challenge.mode) {
  const wrapper = document.createElement('div');
  wrapper.className = 'challenge-item';
  const title = document.createElement('strong');
  title.textContent = `${challenge.from} → ${challenge.to} • ${challenge.mode}`;
  wrapper.appendChild(title);

  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent = `${challenge.letterCount} letters`;
  wrapper.appendChild(detail);

  if (challenge.hint) {
    const hint = document.createElement('div');
    hint.textContent = `Hint: ${challenge.hint}`;
    wrapper.appendChild(hint);
  }

  if (includeRespondActions && modeId !== 'daily') {
    const wordInput = document.createElement('input');
    wordInput.placeholder = 'Assign your return word';
    wordInput.maxLength = 8;
    wordInput.dataset.word = challenge.id;
    wrapper.appendChild(wordInput);

    const hintInput = document.createElement('input');
    hintInput.placeholder = 'Optional hint/category';
    hintInput.maxLength = 100;
    hintInput.dataset.hint = challenge.id;
    wrapper.appendChild(hintInput);

    const row = document.createElement('div');
    row.className = 'row';
    const accept = document.createElement('button');
    accept.textContent = 'Accept & Start';
    accept.dataset.accept = challenge.id;
    const reject = document.createElement('button');
    reject.className = 'danger';
    reject.textContent = 'Reject';
    reject.dataset.reject = challenge.id;
    row.append(accept, reject);
    wrapper.appendChild(row);
  } else if (includeRespondActions) {
    const row = document.createElement('div');
    row.className = 'row';
    const accept = document.createElement('button');
    accept.textContent = 'Accept & Start';
    accept.dataset.accept = challenge.id;
    const reject = document.createElement('button');
    reject.className = 'danger';
    reject.textContent = 'Reject';
    reject.dataset.reject = challenge.id;
    row.append(accept, reject);
    wrapper.appendChild(row);
  }

  return wrapper;
}

function gameItem(game) {
  const wrapper = document.createElement('div');
  wrapper.className = 'challenge-item';
  const button = document.createElement('button');
  button.className = 'secondary full-width';
  button.dataset.gameId = game.id;
  button.textContent = `Open ${game.mode} vs ${game.players.filter((p) => p !== state.username).join(', ') || 'self'}`;
  wrapper.appendChild(button);
  return wrapper;
}

function renderModeSections() {
  const mode = MODES.find((entry) => entry.id === state.selectedMode);
  elements.modeSections.innerHTML = '';
  if (!mode) return;

  if (state.loadingChallenges) {
    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.textContent = 'Loading challenges...';
    elements.modeSections.appendChild(loading);
    return;
  }

  const incoming = state.challengeData.incoming.filter((challenge) => challenge.mode === mode.id);
  const outgoing = state.challengeData.outgoing.filter((challenge) => challenge.mode === mode.id);
  const activeGames = state.challengeData.activeGames.filter((game) => game.mode === mode.id);

  if (mode.type === 'realtime') {
    elements.modeSections.appendChild(createSection(
      'Pending Challenges',
      outgoing,
      'No pending challenges sent yet.',
      (challenge) => challengeItem(challenge, false, mode.id),
    ));
    elements.modeSections.appendChild(createSection(
      'Incoming Challenges',
      [...incoming, ...activeGames],
      'No incoming challenges right now.',
      (item) => (item.players ? gameItem(item) : challengeItem(item, true, mode.id)),
    ));
    return;
  }

  const currentChallenges = [...outgoing, ...incoming, ...activeGames];
  elements.modeSections.appendChild(createSection(
    'Current Challenges',
    currentChallenges,
    'No current challenges for this mode.',
    (item) => (item.players ? gameItem(item) : challengeItem(item, item.to === state.username, mode.id)),
  ));
}

function renderModePanel() {
  if (!state.loggedIn || !state.selectedMode) {
    elements.modePanel.classList.add('hidden');
    return;
  }

  const mode = MODES.find((entry) => entry.id === state.selectedMode);
  elements.modePanel.classList.remove('hidden');
  elements.modePanelTitle.textContent = mode.label;

  if (mode.id === 'solo') {
    elements.modeHelpText.textContent = 'Solo mode starts immediately in the main board.';
    elements.opponent.parentElement.classList.add('hidden');
    elements.challengeFields.classList.add('hidden');
    elements.challengeBtn.classList.add('hidden');
  } else {
    elements.modeHelpText.textContent = mode.type === 'realtime'
      ? 'Search a player, challenge them, and monitor pending/incoming challenges.'
      : 'Search a player, send a challenge, and open current challenge games here.';
    elements.opponent.parentElement.classList.remove('hidden');
    elements.challengeFields.classList.toggle('hidden', mode.id !== 'head-to-head' && mode.id !== 'blind');
    elements.challengeBtn.classList.remove('hidden');
  }

  renderModeSections();
}

async function loadUsers() {
  if (!state.loggedIn) return;
  const query = elements.opponent.value.trim();
  const data = await api(`/api/users?query=${encodeURIComponent(query)}`);
  elements.userOptions.innerHTML = data.users.map((user) => `<option value="${user.username}"></option>`).join('');
}

async function loadChallenges() {
  if (!state.loggedIn || !state.username) return;
  state.loadingChallenges = true;
  renderModeSections();

  try {
    const data = await api(`/api/challenges/${encodeURIComponent(state.username)}`);
    state.challengeData = {
      incoming: data.incoming || data.challenges || [],
      outgoing: data.outgoing || [],
      activeGames: data.activeGames || [],
    };
  } finally {
    state.loadingChallenges = false;
    renderModeSections();
  }
}

function updateActiveGameCache(game) {
  const games = state.challengeData.activeGames || [];
  const index = games.findIndex((entry) => entry.id === game.id);
  if (game.status === 'active') {
    if (index >= 0) {
      games[index] = game;
    } else {
      games.unshift(game);
    }
  } else if (index >= 0) {
    games.splice(index, 1);
  }
  state.challengeData.activeGames = games;

  const challengeId = game.metadata?.challengeId;
  if (challengeId) {
    state.challengeData.incoming = state.challengeData.incoming.filter((challenge) => challenge.id !== challengeId);
    state.challengeData.outgoing = state.challengeData.outgoing.filter((challenge) => challenge.id !== challengeId);
  }
}

async function submitGuess() {
  if (!state.currentGame) return;

  const guess = elements.guess.value.trim().toLowerCase();
  if (!guess) return;

  const data = await api('/api/game/guess', {
    method: 'POST',
    body: JSON.stringify({ gameId: state.currentGame.id, username: state.username, guess }),
  });
  state.currentGame = data.game;
  elements.guess.value = '';
  renderGame();
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
      state.challengeData.incoming = payload.challenges || [];
      if (!state.currentGame && payload.activeGames?.length) {
        state.currentGame = payload.activeGames[0];
      }
      renderGame();
      loadChallenges().catch(() => {});
      return;
    }

    if (payload.type === 'challenge_pending') {
      if (!state.challengeData.incoming.some((challenge) => challenge.id === payload.challenge.id)) {
        state.challengeData.incoming.unshift(payload.challenge);
      }
      renderModeSections();
      return;
    }

    if (payload.type === 'challenge_rejected') {
      state.challengeData.outgoing = state.challengeData.outgoing.filter((challenge) => challenge.id !== payload.challenge?.id);
      renderModeSections();
      return;
    }

    if (payload.type === 'game_update') {
      updateActiveGameCache(payload.game);
      if (state.currentGame?.id === payload.game.id || !state.currentGame) {
        state.currentGame = payload.game;
        renderGame();
      }
      renderModeSections();
    }
  };
}

async function startGame(mode, opponent = '') {
  const letterCount = Number(elements.letterCount.value);
  const data = await api('/api/game/start', {
    method: 'POST',
    body: JSON.stringify({ mode, username: state.username, opponent, letterCount }),
  });
  state.currentGame = data.game;
  renderGame();
}

async function startSolo() {
  try {
    await startGame('solo');
    setModeStatus('Started a new solo game.');
  } catch (error) {
    setModeStatus(error.message);
  }
}

async function startGuestSession() {
  const guestName = `guest-${Date.now().toString(36)}`;
  await api('/api/register', { method: 'POST', body: JSON.stringify({ username: guestName }) });
  state.username = guestName;
  state.loggedIn = false;
  elements.authStatus.textContent = 'Playing as guest. Use Login for multiplayer modes.';
  await startSolo();
}

function renderModeCards() {
  elements.modeCards.innerHTML = '';
  for (const mode of MODES) {
    const button = document.createElement('button');
    button.className = `mode-card${state.selectedMode === mode.id ? ' active' : ''}`;
    button.dataset.mode = mode.id;
    const subtitle = mode.type === 'realtime' ? 'Real-time' : mode.type === 'nonrealtime' ? 'Non-real-time' : 'Solo';
    button.innerHTML = `<strong>${mode.label}</strong><span>${subtitle}</span>`;
    elements.modeCards.appendChild(button);
  }
}

elements.authToggleBtn.addEventListener('click', () => {
  elements.authPanel.classList.toggle('hidden');
});

elements.registerBtn.addEventListener('click', async () => {
  try {
    const username = elements.username.value.trim();
    await api('/api/register', { method: 'POST', body: JSON.stringify({ username }) });
    state.username = username;
    state.loggedIn = true;
    elements.authStatus.textContent = `Logged in as ${username}`;
    elements.authToggleBtn.textContent = username;
    elements.authPanel.classList.add('hidden');
    elements.modeSidebar.classList.remove('hidden');
    state.selectedMode = state.selectedMode || 'quick-fire';
    renderModeCards();
    renderModePanel();
    connectSocket();
    await loadUsers();
    await loadChallenges();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
});

elements.startSoloBtn.addEventListener('click', () => {
  startSolo();
});

elements.modeCards.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-mode]');
  if (!card) return;
  state.selectedMode = card.dataset.mode;
  renderModeCards();
  renderModePanel();
  setModeStatus('');

  if (state.selectedMode === 'solo') {
    await startSolo();
  }
});

elements.opponent.addEventListener('input', () => {
  loadUsers().catch(() => {});
});

elements.challengeBtn.addEventListener('click', async () => {
  const mode = state.selectedMode;
  if (!mode) return;

  try {
    if (mode === 'daily' || mode === 'head-to-head' || mode === 'blind') {
      await api('/api/challenge/create', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          from: state.username,
          to: elements.opponent.value.trim(),
          letterCount: Number(elements.letterCount.value),
          assignedWord: elements.assignedWord.value.trim().toLowerCase() || undefined,
          hint: elements.hint.value.trim(),
        }),
      });
      setModeStatus(`Challenge sent to ${elements.opponent.value.trim()}.`);
      await loadChallenges();
      return;
    }

    if (mode === 'quick-fire') {
      await startGame(mode, elements.opponent.value.trim());
      setModeStatus('Quick Fire started.');
      await loadChallenges();
      return;
    }

    await startGame(mode);
    setModeStatus(`${MODES.find((entry) => entry.id === mode)?.label} started.`);
  } catch (error) {
    setModeStatus(error.message);
  }
});

elements.modeSections.addEventListener('click', async (event) => {
  const acceptId = event.target.getAttribute('data-accept');
  const rejectId = event.target.getAttribute('data-reject');
  const gameId = event.target.getAttribute('data-game-id');

  try {
    if (gameId) {
      const data = await api(`/api/game/${encodeURIComponent(gameId)}?username=${encodeURIComponent(state.username)}`);
      state.currentGame = data.game;
      renderGame();
      return;
    }

    if (!acceptId && !rejectId) return;
    const challengeId = acceptId || rejectId;

    if (acceptId) {
      const assignedWordBack = document.querySelector(`input[data-word="${challengeId}"]`)?.value?.trim()?.toLowerCase() || '';
      const hintBack = document.querySelector(`input[data-hint="${challengeId}"]`)?.value?.trim() || '';
      const data = await api('/api/challenge/respond', {
        method: 'POST',
        body: JSON.stringify({ challengeId, username: state.username, accept: true, assignedWordBack, hintBack }),
      });
      state.currentGame = data.game;
      renderGame();
    } else {
      await api('/api/challenge/respond', {
        method: 'POST',
        body: JSON.stringify({ challengeId, username: state.username, accept: false }),
      });
    }
    await loadChallenges();
  } catch (error) {
    setModeStatus(error.message);
  }
});

elements.guessBtn.addEventListener('click', async () => {
  try {
    await submitGuess();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
});

elements.guess.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  try {
    await submitGuess();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
});

elements.keyboard.addEventListener('click', async (event) => {
  const key = event.target.closest('[data-key]')?.dataset.key;
  if (!key || !state.currentGame || state.currentGame.status !== 'active') return;

  if (key === 'enter') {
    try {
      await submitGuess();
    } catch (error) {
      elements.gameMeta.textContent = error.message;
    }
    return;
  }

  if (key === 'backspace') {
    elements.guess.value = elements.guess.value.slice(0, -1);
    elements.guess.focus();
    return;
  }

  if (elements.guess.value.length >= state.currentGame.letterCount) return;
  elements.guess.value += key;
  elements.guess.focus();
});

(async () => {
  renderModeCards();
  renderGame();
  try {
    await startGuestSession();
  } catch (error) {
    elements.gameMeta.textContent = error.message;
  }
})();
