# Technopoly

A multiplayer technology-themed board game played through the browser.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python run.py
```

The server starts on `http://0.0.0.0:5000`. Open it in your browser.

## How to Play

1. **One person** logs in with the **master password** (`master`) — they control when the game starts.
2. **Other players** log in with the **player password** (`player`) and enter their name. They'll wait in the lobby.
3. The game master clicks **Start Game** when everyone is ready.
4. A random player goes first. On your turn you can **draw cards**, **play cards** (costs credits), or **end your turn**.
5. When all players have taken a turn, a new **generation** begins and everyone collects their production resources.

## Adding Cards

Card definitions live in `data/cards/` as YAML files. Each file holds a list of cards of a particular type. Just add entries following the existing format.

### Card types

| File | Type | Key fields |
|------|------|------------|
| `technology_cards.yaml` | Technology | cost, tag, production |
| `action_cards.yaml` | Action | cost, tag, effect |
| `resource_cards.yaml` | Resource | cost, tag, immediate, production |

## Hosting on Raspberry Pi

```bash
# On your Pi
pip install -r requirements.txt
python run.py
```

Then open `http://<your-pi-ip>:5000` from any device on the same network.

## Project Structure

```
technopoly/
├── data/cards/          # YAML card definitions
├── server/
│   ├── app.py           # Flask + SocketIO backend
│   └── models/          # Card, Player, Game objects
├── static/              # CSS & JS
├── templates/           # HTML
├── run.py               # Entry point
└── requirements.txt
```
