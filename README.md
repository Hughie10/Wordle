# Multiplayer Wordle

Single-container multiplayer Wordle with a Node.js + Express server, built-in frontend, WebSocket updates, and JSONL persistence.

## Features

- Single Node.js + Express app serving HTML/CSS/JS frontend
- Local dictionary (`/config/words.json`) with 100+ words and configurable 3-8 letter gameplay
- JSONL storage (`users.jsonl`, `games.jsonl`, `challenges.jsonl`, `scores.jsonl`)
- WebSocket real-time updates for game progress and challenge notifications
- Modes:
  - Solo
  - Quick Fire (real-time race)
  - Daily Challenge (UTC daily word)
  - Head-to-Head (players assign each other words)
  - Survival (increasing difficulty)
  - Blind Challenge (category/theme hints)
- Leaderboards (overall and per mode)
- Opponent history and per-opponent stats
- Challenge inbox with accept/reject flow
- Spotify-inspired black + green UI

## Run locally

```bash
npm install
npm start
```

App: `http://localhost:3000`

### Test

```bash
npm test
```

## Data persistence

Set `DATA_DIR` (defaults to `/data`).

```bash
DATA_DIR=./data npm start
```

## Docker

```bash
docker build -t wordle-multiplayer .
docker run -p 3000:3000 -v wordle_data:/data wordle-multiplayer
```

## TrueNAS Scale

Use `/truenas-scale.yaml` and mount an `ixVolume` to `/data` so user and game state JSONL files persist.
