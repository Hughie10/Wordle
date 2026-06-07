const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGuess, pickDailyWord, clampLetterCount, getDailyKey } = require('../src/game');

test('evaluateGuess handles duplicate letters correctly', () => {
  const result = evaluateGuess('level', 'hello');
  assert.deepEqual(result, ['absent', 'correct', 'present', 'present', 'absent']);
});

test('pickDailyWord is deterministic for same date and length', () => {
  const words = ['cat', 'dog', 'sun', 'light', 'green'];
  const key = '2026-01-01';
  assert.equal(pickDailyWord(words, key, 3), pickDailyWord(words, key, 3));
});

test('clampLetterCount enforces supported bounds', () => {
  assert.equal(clampLetterCount(2), 3);
  assert.equal(clampLetterCount(5), 5);
  assert.equal(clampLetterCount(99), 8);
  assert.equal(clampLetterCount('bad'), 5);
});

test('getDailyKey uses UTC date formatting', () => {
  assert.equal(getDailyKey(new Date('2026-06-07T09:00:00.000Z')), '2026-06-07');
});
