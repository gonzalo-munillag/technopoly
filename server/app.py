from __future__ import annotations
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room

from .models import Game
from .models.game import Phase, CARDS_PER_TURN

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = Flask(
    __name__,
    template_folder="../templates",
    static_folder="../static",
)
app.secret_key = os.environ["FLASK_SECRET_KEY"]

socketio = SocketIO(app, cors_allowed_origins="*")

PLAYER_PASSWORD = os.environ["PLAYER_PASSWORD"]
MASTER_PASSWORD = os.environ["MASTER_PASSWORD"]

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
        master_connected = (
            game.game_master_id is not None
            and game.game_master_id in connected_players
        )
        if master_connected:
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


# ── Game lifecycle ───────────────────────────────────────────

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
    _send_private_states()


@socketio.on("restart_game")
def on_restart_game():
    if request.sid != game.game_master_id:
        emit("error", {"message": "Only the game master can restart the game."})
        return
    game.restart()
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()


@socketio.on("end_game")
def on_end_game():
    if request.sid != game.game_master_id:
        emit("error", {"message": "Only the game master can end the game."})
        return
    game.end_game()
    connected_players.clear()
    socketio.emit("game_ended", {}, room="game")


# ── Company pick phase ──────────────────────────────────────

@socketio.on("pick_company")
def on_pick_company(data):
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.COMPANY_PICK:
        return

    player = game.players.get(player_id)
    if player and player.company is not None:
        emit("error", {"message": "You already picked a company. Waiting for others."})
        return

    card_name = data.get("card_name", "")
    card = game.pick_company(player_id, card_name)
    if not card:
        emit("error", {"message": f"Could not pick company '{card_name}'."})
        return

    _send_private_states()
    socketio.emit("game_state", game.to_dict(), room="game")

    if game.all_players_ready():
        game.begin_year_draft()
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


# ── Draft phase ──────────────────────────────────────────────

@socketio.on("keep_card")
def on_keep_card(data):
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.YEAR_START_DRAFT:
        return

    player = game.players.get(player_id)
    if player and player.ready:
        emit("error", {"message": "You already finished drafting."})
        return

    card_name = data.get("card_name", "")
    if not game.keep_drafted_card(player_id, card_name):
        emit("error", {"message": f"Cannot keep '{card_name}'. Not enough money (costs 3)."})
        return

    if not player.draft_pool:
        _finish_player_draft(player_id)
    else:
        _send_private_states()
        socketio.emit("game_state", game.to_dict(), room="game")


@socketio.on("done_drafting")
def on_done_drafting():
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.YEAR_START_DRAFT:
        return
    _finish_player_draft(player_id)


def _finish_player_draft(player_id: str):
    game.finish_draft(player_id)
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()

    if game.all_drafts_done():
        game.finalize_draft()
        _begin_player_turns()


def _begin_player_turns():
    game.phase = Phase.PLAYER_TURNS
    game.clear_ready()
    game.current_turn_index = game.dealer_index
    for player in game.players.values():
        player.reset_turn()
        player.year_done = False

    current = game.players.get(game.current_player_id)
    if current and len(current.hand) == 0:
        current.year_done = True
        _advance_to_next_or_end_year()
        return

    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()


# ── Regulation phase ────────────────────────────────────────

@socketio.on("regulation_accept")
def on_regulation_accept():
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.REGULATION:
        return

    player = game.players.get(player_id)
    if not player or player.regulation_resolved:
        return

    penalty = game.resolve_regulation_accept(player_id)
    emit("regulation_result", {
        "action": "accept",
        "penalty": penalty,
    })
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_regulation_done()


@socketio.on("regulation_court")
def on_regulation_court():
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.REGULATION:
        return

    player = game.players.get(player_id)
    if not player or player.regulation_resolved:
        return

    result = game.resolve_regulation_court(player_id)
    emit("regulation_result", {
        "action": "court",
        **result,
    })
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_regulation_done()


@socketio.on("proceed_regulation")
def on_proceed_regulation():
    """Unaffected players click this to acknowledge the regulation."""
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.REGULATION:
        return
    player = game.players.get(player_id)
    if not player or player.regulation_resolved:
        return
    player.regulation_resolved = True
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_regulation_done()


def _check_regulation_done():
    if game.all_regulation_resolved():
        game.advance_past_regulation()
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


def _send_regulation_alerts():
    if not game.current_regulation:
        return
    reg = game.current_regulation
    anyone_affected = game.any_player_affected()
    for sid, player_id in connected_players.items():
        player = game.players.get(player_id)
        if not player:
            continue
        affected = player.is_affected_by_regulation(reg)
        socketio.emit("regulation_alert", {
            "affected": affected,
            "any_affected": anyone_affected,
            "regulation": reg.to_dict(),
            "penalty": reg.penalty if affected else {},
            "court_penalty": reg.court_penalty if affected else {},
            "court_threshold": reg.court_threshold,
        }, room=sid)


# ── Player turns phase ──────────────────────────────────────

@socketio.on("play_card")
def on_play_card(data):
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player:
        return

    card_name = data.get("card_name", "")
    card = next((c for c in player.hand if c.name == card_name), None)
    if not card:
        emit("error", {"message": f"Card '{card_name}' not in your hand."})
        return

    if player.has_pending_fuckups():
        if card.card_type != "fuck_up":
            emit("error", {"message": "You have fuck-up cards — they are the ONLY thing you can play this turn."})
            return
        removed = player.remove_from_hand(card_name)
        if removed:
            player.apply_card_effects(removed)
            game.discard_pile.append(removed)

        if player.has_pending_fuckups():
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
        else:
            if len(player.hand) == 0:
                player.year_done = True
            _advance_to_next_or_end_year()
        return

    if player.cards_played_this_turn >= CARDS_PER_TURN:
        emit("error", {"message": f"You can only play {CARDS_PER_TURN} cards per turn."})
        return
    if not player.can_afford(card):
        emit("error", {"message": f"Not enough money to play '{card_name}'."})
        return
    player.spend(card.cost)
    player.play_card(card_name)

    if len(player.hand) == 0:
        player.year_done = True
        _advance_to_next_or_end_year()
    else:
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


@socketio.on("end_turn")
def on_end_turn():
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if player and player.has_pending_fuckups():
        emit("error", {"message": "You must play all fuck-up cards before ending your turn."})
        return

    _advance_to_next_or_end_year()


@socketio.on("end_year")
def on_end_year():
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player:
        return
    if player.has_pending_fuckups():
        emit("error", {"message": "You must play all fuck-up cards first."})
        return
    player.year_done = True
    _advance_to_next_or_end_year()


def _advance_to_next_or_end_year():
    next_pid = game.next_turn()
    if next_pid is None:
        _handle_year_end()
    else:
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


def _handle_year_end():
    game.end_current_year()
    if game.phase == Phase.REGULATION:
        _send_regulation_alerts()
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()


# ── helpers ──────────────────────────────────────────────────

def _broadcast_lobby():
    players = [
        {"player_id": pid, "name": p.name}
        for pid, p in game.players.items()
    ]
    socketio.emit("lobby_update", {"players": players}, room="game")


def _send_private_states():
    for sid, player_id in connected_players.items():
        player = game.players.get(player_id)
        if player:
            offers = game.company_offers.get(player_id, [])
            fuckups = game.drafted_fuckups.get(player_id, [])
            reg_affected = (
                player.is_affected_by_regulation(game.current_regulation)
                if game.current_regulation else False
            )
            socketio.emit("your_state", {
                "hand": [c.to_dict() for c in player.hand],
                "draft_pool": [c.to_dict() for c in player.draft_pool],
                "resources": player.resources,
                "production": player.production,
                "cards_played_this_turn": player.cards_played_this_turn,
                "ready": player.ready,
                "has_fuckups": player.has_pending_fuckups(),
                "regulation_resolved": player.regulation_resolved,
                "regulation_affected": reg_affected,
                "company_offers": [c.to_dict() for c in offers],
                "drafted_fuckups": [c.to_dict() for c in fuckups],
                "year_done": player.year_done,
            }, room=sid)
