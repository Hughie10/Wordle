const fs = require('node:fs');
const path = require('node:path');

function readJsonl(filePath, keyField) {
  const map = new Map();
  if (!fs.existsSync(filePath)) {
    return map;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record && record[keyField]) {
        map.set(record[keyField], record);
      }
    } catch {
      // Ignore malformed lines
    }
  }

  return map;
}

class JsonlStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });

    this.paths = {
      users: path.join(this.dataDir, 'users.jsonl'),
      games: path.join(this.dataDir, 'games.jsonl'),
      challenges: path.join(this.dataDir, 'challenges.jsonl'),
      scores: path.join(this.dataDir, 'scores.jsonl'),
    };

    this.users = readJsonl(this.paths.users, 'username');
    this.games = readJsonl(this.paths.games, 'id');
    this.challenges = readJsonl(this.paths.challenges, 'id');
    this.scores = readJsonl(this.paths.scores, 'username');
  }

  append(filePath, record) {
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  saveUser(user) {
    this.users.set(user.username, user);
    this.append(this.paths.users, user);
    return user;
  }

  saveGame(game) {
    this.games.set(game.id, game);
    this.append(this.paths.games, game);
    return game;
  }

  saveChallenge(challenge) {
    this.challenges.set(challenge.id, challenge);
    this.append(this.paths.challenges, challenge);
    return challenge;
  }

  saveScore(score) {
    this.scores.set(score.username, score);
    this.append(this.paths.scores, score);
    return score;
  }

  getUser(username) {
    return this.users.get(username);
  }

  listUsers(prefix = '') {
    const needle = prefix.toLowerCase();
    return [...this.users.values()]
      .filter((user) => user.username.toLowerCase().includes(needle))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  getGame(id) {
    return this.games.get(id);
  }

  listGamesByUser(username) {
    return [...this.games.values()].filter((game) => (game.players || []).includes(username));
  }

  listChallengesForUser(username) {
    return [...this.challenges.values()].filter(
      (challenge) => challenge.to === username && challenge.status === 'pending',
    );
  }

  listOutgoingChallengesForUser(username) {
    return [...this.challenges.values()].filter(
      (challenge) => challenge.from === username && challenge.status === 'pending',
    );
  }

  getChallenge(id) {
    return this.challenges.get(id);
  }

  getScore(username) {
    return this.scores.get(username);
  }

  listScores() {
    return [...this.scores.values()];
  }
}

module.exports = { JsonlStore };
