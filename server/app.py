from __future__ import annotations
import os
import time
import uuid
import threading
from pathlib import Path

import yaml
from dotenv import load_dotenv
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room

from .models import Game
from .models.game import Phase, CARDS_DIR, P, load_params, PARAMS_FILE

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = Flask(
    __name__,
    template_folder="../templates",
    static_folder="../static",
)
app.secret_key = os.environ["FLASK_SECRET_KEY"]
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

@app.after_request
def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

socketio = SocketIO(app, cors_allowed_origins="*")

PLAYER_PASSWORD = os.environ["PLAYER_PASSWORD"]
MASTER_PASSWORD = os.environ["MASTER_PASSWORD"]

game = Game()
connected_players: dict[str, str] = {}  # sid -> player_id
editor_sids: set[str] = set()
editor_player_ids: set[str] = set()
locked_cards: dict[str, str] = {}  # "card_type:index" -> sid

INACTIVITY_TIMEOUT = 3 * 3600  # 3 hours in seconds
_last_activity: float = time.time()
_inactivity_lock = threading.Lock()


def _touch_activity():
    global _last_activity
    with _inactivity_lock:
        _last_activity = time.time()


def _inactivity_watchdog():
    """Background thread that ends the game after INACTIVITY_TIMEOUT of no player actions."""
    while True:
        time.sleep(1800)
        if not game.started:
            continue
        with _inactivity_lock:
            elapsed = time.time() - _last_activity
        if elapsed >= INACTIVITY_TIMEOUT:
            game.end_game()
            connected_players.clear()
            socketio.emit("game_ended", {}, room="game")


_watchdog_thread = threading.Thread(target=_inactivity_watchdog, daemon=True)
_watchdog_thread.start()

BOARD_CONFIG_FILE = CARDS_DIR / "board_config.yaml"

if BOARD_CONFIG_FILE.exists():
    with open(BOARD_CONFIG_FILE) as _f:
        _cfg = yaml.safe_load(_f) or []
    game.board.load_config(_cfg)

CARD_TYPE_FILES = {
    "company": "company.yaml",
    "platform": "platform.yaml",
    "cyber_attack": "cyber_attacks.yaml",
    "fuck_up": "fuck_ups.yaml",
    "leverage": "leverage.yaml",
    "innovation": "innovation.yaml",
    "build": "build.yaml",
    "regulation": "regulation.yaml",
}


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
    if sid in editor_sids:
        editor_sids.discard(sid)
        released = [k for k, v in locked_cards.items() if v == sid]
        for key in released:
            del locked_cards[key]
            socketio.emit("card_unlocked", {"key": key}, room="editors")


@socketio.on("login")
def on_login(data):
    _touch_activity()
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not name:
        emit("login_error", {"message": "Please enter a name."})
        return

    # ── Reconnection: re-bind existing player to new sid ─────
    existing_pid = None
    for pid, player in game.players.items():
        if player.name == name:
            existing_pid = pid
            break

    if existing_pid and request.sid not in connected_players:
        old_sids = [s for s, p in connected_players.items() if p == existing_pid]
        for s in old_sids:
            del connected_players[s]
        connected_players[request.sid] = existing_pid
        join_room("game")
        is_ed = existing_pid in editor_player_ids
        if is_ed:
            editor_sids.add(request.sid)
            join_room("editors")
        role = "master" if existing_pid.startswith("master-") else "player"
        if role == "master":
            game.game_master_id = request.sid
        emit("login_success", {
            "role": role,
            "player_id": existing_pid,
            "name": name,
            "is_editor": is_ed,
        })
        if game.started:
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
        else:
            _broadcast_lobby()
        return

    # ── Fresh login ──────────────────────────────────────────
    if password == MASTER_PASSWORD:
        master_connected = (
            game.game_master_id is not None
            and game.game_master_id in connected_players
        )
        editor_sids.add(request.sid)
        join_room("editors")
        if master_connected:
            if game.started:
                emit("login_error", {"message": "Game already in progress."})
                return
            player_id = f"player-{uuid.uuid4().hex[:8]}"
            player = game.add_player(player_id, name)
            connected_players[request.sid] = player_id
            editor_player_ids.add(player_id)
            join_room("game")
            emit("login_success", {"role": "player", "player_id": player_id, "name": name, "is_editor": True})
            _broadcast_lobby()
        else:
            player_id = f"master-{uuid.uuid4().hex[:8]}"
            game.game_master_id = request.sid
            player = game.add_player(player_id, name)
            connected_players[request.sid] = player_id
            editor_player_ids.add(player_id)
            join_room("game")
            emit("login_success", {"role": "master", "player_id": player_id, "name": name, "is_editor": True})
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
    _touch_activity()
    if request.sid != game.game_master_id:
        emit("error", {"message": "Only the game master can start the game."})
        return
    if len(game.players) < 2:
        emit("error", {"message": "Need at least 2 players to start."})
        return

    game.start()
    _load_board_config()
    socketio.emit("game_started", game.to_dict(), room="game")
    _send_private_states()


@socketio.on("restart_game")
def on_restart_game():
    if request.sid != game.game_master_id:
        emit("error", {"message": "Only the game master can restart the game."})
        return
    game.restart()
    _load_board_config()
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
    _touch_activity()
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

    if card.starting_tiles:
        player._remaining_starting_tiles = list(card.starting_tiles)
        player.pending_tile = player._remaining_starting_tiles.pop(0)

    _send_private_states()
    socketio.emit("game_state", game.to_dict(), room="game")

    if game.all_players_ready():
        if any(p.pending_tile for p in game.players.values()):
            pass
        else:
            game.begin_year_draft()
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()


# ── Draft phase ──────────────────────────────────────────────

@socketio.on("keep_card")
def on_keep_card(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.YEAR_START_DRAFT:
        return

    player = game.players.get(player_id)
    if player and player.ready:
        emit("error", {"message": "You already finished drafting."})
        return

    card_name = data.get("card_name", "")
    if not game.keep_drafted_card(player_id, card_name):
        emit("error", {"message": f"Cannot keep '{card_name}'. Not enough money (costs {P('draft_cost', 3)})."})
        return

    if not player.draft_pool:
        _finish_player_draft(player_id)
    else:
        _send_private_states()
        socketio.emit("game_state", game.to_dict(), room="game")


@socketio.on("done_drafting")
def on_done_drafting():
    _touch_activity()
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
        _begin_hiring()


def _begin_hiring():
    game.phase = Phase.HIRING
    game.clear_ready()
    for player in game.players.values():
        player.hiring_done = False
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()


@socketio.on("submit_hiring")
def on_submit_hiring(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.HIRING:
        return
    player = game.players.get(player_id)
    if not player or player.hiring_done:
        return

    engineers = int(data.get("engineers", 0))
    suits = int(data.get("suits", 0))
    hr = player.production.get("HR", 0)

    rep_mod = player.reputation_modifier()

    if hr >= 0:
        total_to_hire = max(0, hr + rep_mod)
        if engineers < 0 or suits < 0:
            emit("error", {"message": "Cannot hire negative employees."})
            return
        if engineers + suits != total_to_hire:
            emit("error", {"message": f"Must hire exactly {total_to_hire} employees (HR {hr} + rep modifier {rep_mod:+d})."})
            return
        player.resources["engineers"] = player.resources.get("engineers", 0) + engineers
        player.resources["suits"] = player.resources.get("suits", 0) + suits
    else:
        total_fire = abs(hr)
        if engineers < 0 or suits < 0:
            emit("error", {"message": "Fire counts must be non-negative."})
            return
        if engineers + suits != total_fire:
            emit("error", {"message": f"Must fire exactly {total_fire} employees."})
            return
        player.resources["engineers"] = max(0, player.resources.get("engineers", 0) - engineers)
        player.resources["suits"] = max(0, player.resources.get("suits", 0) - suits)

    player.hiring_done = True
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()

    if all(p.hiring_done for p in game.players.values()):
        _after_hiring()


def _after_hiring():
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
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.REGULATION:
        return

    player = game.players.get(player_id)
    if not player or player.regulation_resolved:
        return

    result = game.resolve_regulation_accept(player_id)
    emit("regulation_result", {
        "action": "accept",
        "compliance": result.get("penalty", {}),
        "lost_cards": result.get("lost_cards", []),
    })
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_regulation_done()


@socketio.on("regulation_court")
def on_regulation_court():
    _touch_activity()
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
        socketio.emit("regulation_all_resolved", {}, room="game")
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


@socketio.on("start_year_after_regulation")
def on_start_year_after_regulation():
    if game.phase != Phase.REGULATION:
        return
    if not game.all_regulation_resolved():
        return
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
        targeted_cards = player.find_targeted_cards(reg) if affected and not reg.targets_all else []
        socketio.emit("regulation_alert", {
            "affected": affected,
            "any_affected": anyone_affected,
            "regulation": reg.to_dict(),
            "compliance": reg.compliance if affected else {},
            "court_penalty": reg.court_penalty if affected else {},
            "court_threshold": reg.court_threshold,
            "targeted_cards": [c.to_dict() for c in targeted_cards],
        }, room=sid)


# ── Player turns phase ──────────────────────────────────────

@socketio.on("play_card")
def on_play_card(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player:
        return

    if player.pending_tile:
        emit("error", {"message": "You must place your tile on the board first."})
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
            player.apply_card_effects(removed, game)
            game.discard_pile.append(removed)

        if player.has_pending_fuckups():
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
        else:
            if len(player.hand) == 0:
                player.year_done = True
            _advance_to_next_or_end_year()
        return

    cpt = P("cards_per_turn", 2)
    if player.cards_played_this_turn >= cpt:
        emit("error", {"message": f"You can only play {cpt} cards per turn."})
        return

    use_optional = data.get("use_optional") or {}
    pay_to = data.get("pay_to") or {}
    err = player.can_afford_costs(card, use_optional)
    if err:
        emit("error", {"message": err})
        return
    player.pay_costs(card, use_optional)

    if card.fee and card.fee_card_id and not player._owns_fee_card(card):
        # Find all other players who have played the fee card
        payees = [
            pid for pid, p in game.players.items()
            if pid != player_id and any(c.id == card.fee_card_id for c in p.played_cards)
        ]
        fee_target = pay_to.get("fee") if len(payees) > 1 else (payees[0] if payees else None)
        if fee_target and fee_target in game.players:
            game.players[fee_target].resources["money"] = \
                game.players[fee_target].resources.get("money", 0) + card.fee

    player.play_card(card_name, game)

    if card.tile_type:
        player.pending_tile = card.tile_type
        player.pending_tile_meta = {
            "factory_refund": card.factory_refund,
            "dc_production_bonus": card.dc_production_bonus,
        }
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
        return

    if len(player.hand) == 0:
        player.year_done = True
        _advance_to_next_or_end_year()
    else:
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


@socketio.on("buy_resource")
def on_buy_resource(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or not game.started:
        return
    player = game.players.get(player_id)
    if not player:
        return
    buy_type = data.get("type")
    if buy_type == "server":
        eng_cost = P("buy_server_engineers", 1)
        money_cost = P("buy_server_money", 1)
        if player.resources.get("engineers", 0) < eng_cost:
            emit("error", {"message": f"Need {eng_cost} engineer(s)."})
            return
        if player.resources.get("money", 0) < money_cost:
            emit("error", {"message": f"Need ${money_cost}."})
            return
        player.resources["engineers"] -= eng_cost
        player.resources["money"] -= money_cost
        player.resources["servers"] = player.resources.get("servers", 0) + 1
    elif buy_type == "ad":
        suit_cost = P("buy_ad_suits", 1)
        money_cost = P("buy_ad_money", 1)
        if player.resources.get("suits", 0) < suit_cost:
            emit("error", {"message": f"Need {suit_cost} suit(s)."})
            return
        if player.resources.get("money", 0) < money_cost:
            emit("error", {"message": f"Need ${money_cost}."})
            return
        player.resources["suits"] -= suit_cost
        player.resources["money"] -= money_cost
        player.resources["ads"] = player.resources.get("ads", 0) + 1
    else:
        return
    socketio.emit("game_state", game.to_dict())
    _send_private_states()


@socketio.on("end_turn")
def on_end_turn():
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if player and player.pending_tile:
        emit("error", {"message": "You must place your tile on the board first."})
        return
    if player and player.has_pending_fuckups():
        emit("error", {"message": "You must play all fuck-up cards before ending your turn."})
        return

    _advance_to_next_or_end_year()


@socketio.on("end_year")
def on_end_year():
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player:
        return
    if player.pending_tile:
        emit("error", {"message": "You must place your tile on the board first."})
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


# ── Board ────────────────────────────────────────────────────

@socketio.on("get_board")
def on_get_board():
    emit("board_state", game.board.to_list())


@socketio.on("place_tile")
def on_place_tile(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id:
        return

    is_company_phase = game.phase == Phase.COMPANY_PICK
    is_turns_phase = game.phase == Phase.PLAYER_TURNS

    if not is_company_phase and not is_turns_phase:
        return
    if is_turns_phase and player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return

    player = game.players.get(player_id)
    if not player or not player.pending_tile:
        emit("error", {"message": "You don't have a tile to place."})
        return

    row, col = data.get("row"), data.get("col")
    meta = player.pending_tile_meta or {}
    bonuses = game.board.place_tile(
        row, col, player.pending_tile, player_id,
        factory_refund=meta.get("factory_refund", 0),
        dc_production_bonus=meta.get("dc_production_bonus", 0),
    )
    if not bonuses:
        emit("error", {"message": "Cannot place a tile there."})
        return

    for res, amt in bonuses.get("immediate", {}).items():
        if res == "users":
            player.gain_users(amt, game)
        else:
            player.resources[res] = player.resources.get(res, 0) + amt
    for res, amt in bonuses.get("production", {}).items():
        player.production[res] = player.production.get(res, 0) + amt

    tile_type = player.pending_tile
    player.pending_tile = None
    player.pending_tile_meta = {}

    # Factory money production: per-card refund from adjacent power plants, added as yearly income
    factory_refund = 0
    if tile_type == "factory":
        factory_refund = game.board.get_adjacent_factory_refund(row, col)
        if factory_refund > 0:
            player.production["money"] = player.production.get("money", 0) + factory_refund

    if player._remaining_starting_tiles:
        player.pending_tile = player._remaining_starting_tiles.pop(0)

    bonus_text = []
    for res, amt in bonuses.get("immediate", {}).items():
        bonus_text.append(f"+{amt} {res}")
    for res, amt in bonuses.get("production", {}).items():
        bonus_text.append(f"+{amt} {res}/yr")
    if factory_refund > 0:
        bonus_text.append(f"+${factory_refund}M/yr factory income")

    socketio.emit("board_update", game.board.to_list(), room="game")
    emit("tile_placed", {
        "tile_type": tile_type,
        "row": row, "col": col,
        "bonuses": ", ".join(bonus_text) if bonus_text else "no bonuses",
    })

    if is_company_phase:
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
        if game.all_players_ready() and not any(p.pending_tile for p in game.players.values()):
            game.begin_year_draft()
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
    elif is_turns_phase:
        if len(player.hand) == 0:
            player.year_done = True
            _advance_to_next_or_end_year()
        else:
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()


# ── Board Editor (master / editors only) ─────────────────────

def _save_board_config():
    config = game.board.get_config()
    with open(BOARD_CONFIG_FILE, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)


def _load_board_config():
    if BOARD_CONFIG_FILE.exists():
        with open(BOARD_CONFIG_FILE) as f:
            config = yaml.safe_load(f) or []
        game.board.load_config(config)


@socketio.on("get_board_editor")
def on_get_board_editor():
    if request.sid not in editor_sids:
        return
    emit("board_editor_data", game.board.to_list())


@socketio.on("edit_board_tile")
def on_edit_board_tile(data):
    if request.sid not in editor_sids:
        return
    row = data.get("row")
    col = data.get("col")
    terrain = data.get("terrain", "empty")
    name = data.get("name", "")
    build_bonuses = data.get("build_bonuses")
    adjacency_bonuses = data.get("adjacency_bonuses")
    if not game.board.set_tile_terrain(
        row, col, terrain, name, build_bonuses, adjacency_bonuses
    ):
        emit("error", {"message": "Invalid tile or terrain type."})
        return
    _save_board_config()
    board_data = game.board.to_list()
    for sid in editor_sids:
        socketio.emit("board_editor_data", board_data, room=sid)
    if game.started:
        socketio.emit("board_update", board_data, room="game")


@socketio.on("add_board_tile")
def on_add_board_tile(data):
    if request.sid not in editor_sids:
        return
    row = data.get("row")
    col = data.get("col")
    if not game.board.add_tile(row, col):
        emit("error", {"message": "Cannot add tile there (occupied or out of bounds)."})
        return
    _save_board_config()
    board_data = game.board.to_list()
    for sid in editor_sids:
        socketio.emit("board_editor_data", board_data, room=sid)
    if game.started:
        socketio.emit("board_update", board_data, room="game")


@socketio.on("remove_board_tile")
def on_remove_board_tile(data):
    if request.sid not in editor_sids:
        return
    row = data.get("row")
    col = data.get("col")
    if not game.board.remove_tile(row, col):
        emit("error", {"message": "No tile at that position."})
        return
    _save_board_config()
    board_data = game.board.to_list()
    for sid in editor_sids:
        socketio.emit("board_editor_data", board_data, room=sid)
    if game.started:
        socketio.emit("board_update", board_data, room="game")


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
                "player_id": player_id,
                "hand": [c.to_dict() for c in player.hand],
                "draft_pool": [c.to_dict() for c in player.draft_pool],
                "resources": player.resources,
                "production": player.production,
                "users": player.users,
                "cards_played_this_turn": player.cards_played_this_turn,
                "ready": player.ready,
                "has_fuckups": player.has_pending_fuckups(),
                "regulation_resolved": player.regulation_resolved,
                "regulation_affected": reg_affected,
                "company_offers": [c.to_dict() for c in offers],
                "drafted_fuckups": [c.to_dict() for c in fuckups],
                "year_done": player.year_done,
                "pending_tile": player.pending_tile,
                "pending_tile_meta": player.pending_tile_meta,
            }, room=sid)


# ── Card Editor ─────────────────────────────────────────────

def _read_all_cards_yaml() -> dict[str, list[dict]]:
    result = {}
    for card_type, filename in CARD_TYPE_FILES.items():
        filepath = CARDS_DIR / filename
        if not filepath.exists():
            result[card_type] = []
            continue
        with open(filepath) as f:
            result[card_type] = yaml.safe_load(f) or []
    return result


def _read_yaml_file(filepath: Path) -> tuple[str, list[dict]]:
    """Read a YAML file, returning the header comments and parsed data."""
    with open(filepath) as f:
        lines = f.readlines()
    header_lines = []
    for line in lines:
        if line.startswith("#") or line.strip() == "":
            header_lines.append(line)
        else:
            break
    header = "".join(header_lines)
    with open(filepath) as f:
        data = yaml.safe_load(f) or []
    return header, data


def _write_yaml_file(filepath: Path, header: str, data: list[dict]):
    with open(filepath, "w") as f:
        if header:
            f.write(header)
            if not header.endswith("\n"):
                f.write("\n")
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _get_locks_for_client(caller_sid: str) -> dict:
    """Return lock info: key -> 'me' or 'other'."""
    return {
        key: ("me" if sid == caller_sid else "other")
        for key, sid in locked_cards.items()
    }


def _next_card_id() -> int:
    """Return the next available globally-unique card ID."""
    max_id = 0
    for cards in _read_all_cards_yaml().values():
        for c in cards:
            max_id = max(max_id, c.get("id", 0))
    return max_id + 1


def _build_card_trees() -> dict:
    """Build tree structures from card boost relationships and compute stats."""
    all_cards = _read_all_cards_yaml()
    card_by_id: dict[int, dict] = {}
    card_type_by_id: dict[int, str] = {}
    for card_type, cards in all_cards.items():
        for card in cards:
            cid = card.get("id", 0)
            if cid:
                card_by_id[cid] = card
                card_type_by_id[cid] = card_type

    target_to_boosters: dict[int, list[dict]] = {}
    booster_ids_with_connections: set[int] = set()
    platform_ids_with_connections: set[int] = set()

    for card_type, cards in all_cards.items():
        for card in cards:
            cid = card.get("id", 0)
            for boost in card.get("boosts") or []:
                raw_tid = boost.get("target_id", 0)
                if isinstance(raw_tid, list):
                    tids = [t for t in raw_tid if isinstance(t, (int, float))]
                elif raw_tid:
                    tids = [raw_tid]
                else:
                    tids = []
                for tid in tids:
                    if tid and tid in card_by_id:
                        target_to_boosters.setdefault(tid, []).append({
                            "card": card,
                            "card_type": card_type,
                            "bonus": boost.get("bonus", {}),
                        })
                        booster_ids_with_connections.add(cid)
                        platform_ids_with_connections.add(tid)

    trees = []
    for tid, boosters in target_to_boosters.items():
        trees.append({
            "target": card_by_id[tid],
            "target_type": card_type_by_id[tid],
            "boosters": boosters,
        })

    connectable_types = {"platform", "leverage", "innovation"}
    all_connectable = {
        cid for cid, ct in card_type_by_id.items() if ct in connectable_types
    }
    platform_ids = {cid for cid, ct in card_type_by_id.items() if ct == "platform"}
    booster_types = {"leverage", "innovation"}
    booster_ids = {cid for cid, ct in card_type_by_id.items() if ct in booster_types}

    unconnected_platforms = len(platform_ids - platform_ids_with_connections)
    unconnected_boosters = len(booster_ids - booster_ids_with_connections)
    total_connections = sum(len(b) for b in target_to_boosters.values())
    avg_boosters = round(total_connections / len(trees), 2) if trees else 0

    return {
        "trees": trees,
        "stats": {
            "total_trees": len(trees),
            "avg_boosters_per_tree": avg_boosters,
            "total_connections": total_connections,
            "unconnected_platforms": unconnected_platforms,
            "unconnected_boosters": unconnected_boosters,
            "total_platform_cards": len(platform_ids),
            "total_booster_cards": len(booster_ids),
        },
    }


def _is_editor(sid: str) -> bool:
    """Check if a sid belongs to an editor (master password user)."""
    if sid in editor_sids:
        return True
    player_id = connected_players.get(sid)
    return player_id is not None and player_id in editor_player_ids

def _ensure_editor(sid: str) -> bool:
    """Ensure sid is in editor_sids if they have editor rights. Returns True if editor."""
    if sid in editor_sids:
        return True
    if _is_editor(sid):
        editor_sids.add(sid)
        join_room("editors")
        return True
    return False

@socketio.on("get_all_cards")
def on_get_all_cards():
    if not _ensure_editor(request.sid):
        emit("editor_error", {"message": "Not authorized as editor."})
        return
    cards = _read_all_cards_yaml()
    emit("all_cards", {
        "cards": cards,
        "locks": _get_locks_for_client(request.sid),
    })


@socketio.on("lock_card")
def on_lock_card(data):
    if request.sid not in editor_sids:
        return
    key = f"{data['card_type']}:{data['index']}"
    if key in locked_cards and locked_cards[key] != request.sid:
        emit("lock_result", {"success": False, "key": key,
                             "message": "Card is being edited by someone else."})
        return
    locked_cards[key] = request.sid
    emit("lock_result", {"success": True, "key": key})
    for sid in editor_sids:
        socketio.emit("card_locked", {
            "key": key,
            "who": "me" if sid == request.sid else "other",
        }, room=sid)


@socketio.on("unlock_card")
def on_unlock_card(data):
    key = f"{data['card_type']}:{data['index']}"
    if locked_cards.get(key) == request.sid:
        del locked_cards[key]
        socketio.emit("card_unlocked", {"key": key}, room="editors")


@socketio.on("save_card")
def on_save_card(data):
    if request.sid not in editor_sids:
        return
    card_type = data["card_type"]
    index = data["index"]
    card_data = data["card_data"]
    key = f"{card_type}:{index}"

    if locked_cards.get(key) != request.sid:
        emit("save_result", {"success": False, "message": "You don't hold the lock."})
        return

    filename = CARD_TYPE_FILES.get(card_type)
    if not filename:
        emit("save_result", {"success": False, "message": "Unknown card type."})
        return

    filepath = CARDS_DIR / filename
    header, entries = _read_yaml_file(filepath)

    if index < 0 or index >= len(entries):
        emit("save_result", {"success": False, "message": "Invalid card index."})
        return

    entries[index] = card_data
    _write_yaml_file(filepath, header, entries)

    locked_cards.pop(key, None)
    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)


@socketio.on("add_card")
def on_add_card(data):
    if request.sid not in editor_sids:
        return
    card_type = data.get("card_type")
    filename = CARD_TYPE_FILES.get(card_type)
    if not filename:
        emit("save_result", {"success": False, "message": "Unknown card type."})
        return

    filepath = CARDS_DIR / filename
    header, entries = _read_yaml_file(filepath)

    _COSTS_TEMPLATE = {
        "engineers": 0, "suits": 0, "ads": 0,
        "money": 0, "servers": 0, "data_centers": 0, "ad_campaigns": 0,
        "reputation": 0, "HR": 0, "users": 0,
        "fee": 0, "fee_card_id": None,
    }
    _CATEGORY_TEMPLATES = {
        "company": {"name": "New Company", "id": _next_card_id(), "tag": "",
                     "description": "", "image": None,
                     "starting_resources": {k: 0 for k in ["engineers", "suits", "ads", "money", "servers", "reputation", "users"]},
                     "starting_production": {"HR": 0, "data_centers": 0, "ad_campaigns": 0},
                     "starting_tiles": []},
        "regulation": {"name": "New Regulation", "id": _next_card_id(), "tag": "",
                        "description": "", "image": None, "targets_all": 1, "target_id": None,
                        "target_type": None, "compliance": {}, "court_penalty": {}, "court_threshold": 4},
    }
    _DEFAULT = {"name": "New Card", "id": _next_card_id(), "image": None, "description": "",
                "type": "", "number": 1, "build": None, "costs": dict(_COSTS_TEMPLATE),
                "effect": {}, "boosts": [],
                "factory_refund": None, "dc_production_bonus": None}

    new_card = _CATEGORY_TEMPLATES.get(card_type, dict(_DEFAULT))
    if "id" not in new_card or new_card["id"] == 0:
        new_card["id"] = _next_card_id()

    entries.append(new_card)
    new_index = len(entries) - 1
    _write_yaml_file(filepath, header, entries)

    key = f"{card_type}:{new_index}"
    locked_cards[key] = request.sid

    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)
        socketio.emit("card_locked", {
            "key": key,
            "who": "me" if sid == request.sid else "other",
        }, room=sid)

    emit("lock_result", {"success": True, "key": key})


GRAVEYARD_FILE = CARDS_DIR / "graveyard.yaml"


def _read_graveyard() -> list[dict]:
    if not GRAVEYARD_FILE.exists():
        return []
    with open(GRAVEYARD_FILE) as f:
        return yaml.safe_load(f) or []


def _write_graveyard(entries: list[dict]):
    with open(GRAVEYARD_FILE, "w") as f:
        f.write("# Card graveyard — deleted cards are stored here\n\n")
        yaml.dump(entries, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


@socketio.on("delete_card")
def on_delete_card(data):
    if request.sid not in editor_sids:
        return
    card_type = data.get("card_type")
    index = data.get("index")
    key = f"{card_type}:{index}"

    if key in locked_cards and locked_cards[key] != request.sid:
        emit("save_result", {"success": False, "message": "Card is locked by someone else."})
        return

    filename = CARD_TYPE_FILES.get(card_type)
    if not filename:
        emit("save_result", {"success": False, "message": "Unknown card type."})
        return

    filepath = CARDS_DIR / filename
    header, entries = _read_yaml_file(filepath)
    if index < 0 or index >= len(entries):
        emit("save_result", {"success": False, "message": "Invalid card index."})
        return

    removed = entries.pop(index)
    _write_yaml_file(filepath, header, entries)

    graveyard = _read_graveyard()
    graveyard.append({"card_type": card_type, "card_data": removed})
    _write_graveyard(graveyard)

    locked_cards.pop(key, None)
    stale = [k for k in locked_cards if k.startswith(f"{card_type}:")]
    for k in stale:
        locked_cards.pop(k, None)
        socketio.emit("card_unlocked", {"key": k}, room="editors")

    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)


@socketio.on("get_graveyard")
def on_get_graveyard():
    if request.sid not in editor_sids:
        return
    emit("graveyard_data", {"cards": _read_graveyard()})


@socketio.on("restore_card")
def on_restore_card(data):
    if request.sid not in editor_sids:
        return
    index = data.get("index")
    graveyard = _read_graveyard()
    if index < 0 or index >= len(graveyard):
        emit("save_result", {"success": False, "message": "Invalid graveyard index."})
        return

    entry = graveyard.pop(index)
    _write_graveyard(graveyard)

    card_type = entry["card_type"]
    card_data = entry["card_data"]
    filename = CARD_TYPE_FILES.get(card_type)
    if filename:
        filepath = CARDS_DIR / filename
        header, entries = _read_yaml_file(filepath)
        entries.append(card_data)
        _write_yaml_file(filepath, header, entries)

    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)
    emit("graveyard_data", {"cards": _read_graveyard()})


@socketio.on("permanent_delete_card")
def on_permanent_delete_card(data):
    if request.sid not in editor_sids:
        return
    index = data.get("index")
    graveyard = _read_graveyard()
    if index < 0 or index >= len(graveyard):
        emit("save_result", {"success": False, "message": "Invalid graveyard index."})
        return
    graveyard.pop(index)
    _write_graveyard(graveyard)
    emit("graveyard_data", {"cards": _read_graveyard()})


@socketio.on("get_card_trees")
def on_get_card_trees():
    if request.sid not in editor_sids:
        return
    result = _build_card_trees()
    result["locks"] = _get_locks_for_client(request.sid)
    emit("card_trees", result)


# ── Parameters editor ────────────────────────────────────────

@socketio.on("get_params")
def on_get_params():
    if not _ensure_editor(request.sid):
        return
    emit("params_data", load_params())

@socketio.on("save_params")
def on_save_params(data):
    if not _ensure_editor(request.sid):
        return
    with open(PARAMS_FILE, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)
    load_params()
    game.total_users = P("total_users", 500)
    socketio.emit("params_data", load_params(), room="editors")
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()


# ── Fetch Data (browser pulls YAML via HTTP) ─────────────────

@app.route("/api/fetch_data", methods=["POST"])
def api_fetch_data():
    from flask import jsonify, request as flask_req
    password = flask_req.json.get("password", "") if flask_req.is_json else ""
    if password != MASTER_PASSWORD:
        return jsonify({"error": "Unauthorized"}), 403
    data_dir = CARDS_DIR.parent
    result = {"cards": {}, "params": None}
    for f in sorted(CARDS_DIR.iterdir()):
        if f.suffix in (".yaml", ".yml") and f.is_file():
            result["cards"][f.name] = f.read_text(encoding="utf-8")
    params_file = data_dir / "params.yaml"
    if params_file.exists():
        result["params"] = params_file.read_text(encoding="utf-8")
    return jsonify(result)