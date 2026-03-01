from __future__ import annotations
import uuid

from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room

from .models import Game

app = Flask(
    __name__,
    template_folder="../templates",
    static_folder="../static",
)
app.secret_key = "technopoly-secret-change-me"

socketio = SocketIO(app, cors_allowed_origins="*")

PLAYER_PASSWORD = "player"
MASTER_PASSWORD = "master"

game = Game()
connected_players: dict[str, str] = {}  # sid -> player_id


# ── HTTP routes ──────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Socket.IO events ────────────────────────────────────────

@socketio.on("connect")
def on_connect():
    pass


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    player_id = connected_players.pop(sid, None)
    if player_id and not game.started:
        game.remove_player(player_id)
        _broadcast_lobby()


@socketio.on("login")
def on_login(data):
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not name:
        emit("login_error", {"message": "Please enter a name."})
        return

    if password == MASTER_PASSWORD:
        player_id = f"master-{uuid.uuid4().hex[:8]}"
        game.game_master_id = request.sid
        player = game.add_player(player_id, name)
        connected_players[request.sid] = player_id
        join_room("game")
        emit("login_success", {"role": "master", "player_id": player_id, "name": name})
        _broadcast_lobby()

    elif password == PLAYER_PASSWORD:
        if game.started:
            emit("login_error", {"message": "Game already in progress."})
            return
        player_id = f"player-{uuid.uuid4().hex[:8]}"
        player = game.add_player(player_id, name)
        connected_players[request.sid] = player_id
        join_room("game")
        emit("login_success", {"role": "player", "player_id": player_id, "name": name})
        _broadcast_lobby()

    else:
        emit("login_error", {"message": "Wrong password."})


@socketio.on("start_game")
def on_start_game():
    if request.sid != game.game_master_id:
        emit("error", {"message": "Only the game master can start the game."})
        return

    if len(game.players) < 2:
        emit("error", {"message": "Need at least 2 players to start."})
        return

    game.start()
    socketio.emit("game_started", game.to_dict(), room="game")
    _send_private_hands()


@socketio.on("end_turn")
def on_end_turn():
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    game.next_turn()
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_hands()


@socketio.on("play_card")
def on_play_card(data):
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    card_name = data.get("card_name", "")
    player = game.players.get(player_id)
    if not player:
        return

    card = next((c for c in player.hand if c.name == card_name), None)
    if not card:
        emit("error", {"message": f"Card '{card_name}' not in your hand."})
        return

    if not player.can_afford(card):
        emit("error", {"message": f"Not enough credits to play '{card_name}'."})
        return

    player.spend(card.cost)
    player.play_card(card_name)

    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_hands()


@socketio.on("draw_card")
def on_draw_card():
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player:
        return

    card = game.draw_card()
    if card is None:
        emit("error", {"message": "No cards left in the deck."})
        return

    player.add_to_hand(card)
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_hands()


# ── helpers ──────────────────────────────────────────────────

def _broadcast_lobby():
    players = [
        {"player_id": pid, "name": p.name}
        for pid, p in game.players.items()
    ]
    socketio.emit("lobby_update", {"players": players}, room="game")


def _send_private_hands():
    """Send each player their own private hand (others can't see it)."""
    for sid, player_id in connected_players.items():
        player = game.players.get(player_id)
        if player:
            socketio.emit("your_hand", {
                "hand": [c.to_dict() for c in player.hand],
                "resources": player.resources,
                "production": player.production,
            }, room=sid)
