const crypto = require('node:crypto');

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase();
}

function evaluateGuess(secretWord, guessWord) {
  const secret = normalizeWord(secretWord);
  const guess = normalizeWord(guessWord);

  if (!secret || secret.length !== guess.length) {
    throw new Error('Guess length must match secret word length');
  }

  const result = new Array(guess.length).fill('absent');
  const remaining = new Map();

  for (let i = 0; i < secret.length; i += 1) {
    if (guess[i] === secret[i]) {
      result[i] = 'correct';
    } else {
      const count = remaining.get(secret[i]) || 0;
      remaining.set(secret[i], count + 1);
    }
  }

  for (let i = 0; i < guess.length; i += 1) {
    if (result[i] === 'correct') {
      continue;
    }

    const count = remaining.get(guess[i]) || 0;
    if (count > 0) {
      result[i] = 'present';
      remaining.set(guess[i], count - 1);
    }
  }

  return result;
}

function makeId(prefix = 'game') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getDailyKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function pickDailyWord(words, dateKey, letterCount) {
  const filtered = words.filter((word) => word.length === letterCount);
  if (!filtered.length) {
    throw new Error(`No words available for length ${letterCount}`);
  }

  const digest = crypto.createHash('sha256').update(`${dateKey}:${letterCount}`).digest('hex');
  const index = Number.parseInt(digest.slice(0, 8), 16) % filtered.length;
  return filtered[index];
}

function pickRandomWord(words, letterCount) {
  const filtered = words.filter((word) => word.length === letterCount);
  if (!filtered.length) {
    throw new Error(`No words available for length ${letterCount}`);
  }

  const index = Math.floor(Math.random() * filtered.length);
  return filtered[index];
}

function clampLetterCount(letterCount) {
  const value = Number.parseInt(letterCount, 10);
  if (Number.isNaN(value)) {
    return 5;
  }

  return Math.max(3, Math.min(8, value));
}

module.exports = {
  clampLetterCount,
  evaluateGuess,
  getDailyKey,
  makeId,
  normalizeWord,
  pickDailyWord,
  pickRandomWord,
};
