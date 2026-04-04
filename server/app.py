from __future__ import annotations
import os
import time
import uuid
import threading
import traceback
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
_PRODUCTION_ONLY_KEYS = {"HR", "data_centers", "ad_campaigns"}

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


def _card_build_types(card) -> list[str]:
    """Return build tile types from a card (supports scalar or list)."""
    def _norm(v):
        if not v:
            return None
        return str(v).strip().replace(" ", "_")
    raw = getattr(card, "build", None)
    if isinstance(raw, list):
        return [b for b in (_norm(x) for x in raw) if b]
    if raw:
        n = _norm(raw)
        return [n] if n else []
    tile = getattr(card, "tile_type", None)
    n = _norm(tile)
    return [n] if n else []


def _money_cost_for_card_play(player, card) -> int:
    """How much money this card play itself deducts (excluding placement fees)."""
    costs = getattr(card, "costs", None) or {}
    if costs:
        total = int(costs.get("money") or 0)
        if card.fee and not player._owns_fee_card(card):
            total += int(card.fee or 0)
        return total
    fee = 0 if player._owns_fee_card(card) else int(card.fee or 0)
    return int(card.cost or 0) + fee


def _placement_fee_options(player_id: str, row: int, col: int, meta: dict | None = None):
    """Return placement fee context for this spot.
    Output: {"amount": int, "payees": [pid,...]} or None if no fee required."""
    meta = meta or {}
    fee_amt = int(meta.get("adjacent_placement_fee") or 0)
    target_types = {
        t for t in (meta.get("adjacent_placement_fee_target_types") or [])
        if t
    }
    if fee_amt <= 0 or not target_types:
        return None
    # If the player already owns an adjacent tile of the required type,
    # no fee is charged — they're using their own infrastructure.
    for nb in game.board.get_neighbors(row, col):
        pt = nb.get("placed_tile")
        if not pt:
            continue
        if pt.get("owner_id") == player_id and pt.get("type") in target_types:
            return None
    payees = set()
    for nb in game.board.get_neighbors(row, col):
        pt = nb.get("placed_tile")
        if not pt:
            continue
        owner = pt.get("owner_id")
        if not owner or owner == player_id:
            continue
        if pt.get("type") in target_types and owner in game.players:
            payees.add(owner)
    if not payees:
        return None
    return {"amount": fee_amt, "payees": list(payees)}


def _placement_error_hint(tile_type: str, meta: dict | None = None) -> str:
    """Build a human-readable error explaining why no placement is possible."""
    bt_label = tile_type.replace("_", " ")
    parts = [f"No legal board placement for {bt_label}."]
    only_next_to = (meta or {}).get("only_playable_next_to") or []
    only_terrains = (meta or {}).get("only_playable_on_terrains") or []
    fee = (meta or {}).get("adjacent_placement_fee") or 0
    if only_next_to:
        labels = [t.replace("_", " ") for t in only_next_to]
        parts.append(f"It must be placed next to: {', '.join(labels)}. Build one first, or place next to another player's.")
    if only_terrains:
        parts.append(f"It can only be built on: {', '.join(only_terrains)}.")
    if fee:
        parts.append(f"Placement fee of ${fee}B may also be required.")
    return " ".join(parts)


def _has_any_legal_tile_placement(
    player,
    tile_type: str,
    meta: dict | None = None,
    money_after_card: int | None = None,
) -> bool:
    """Check if player can legally place this tile anywhere right now."""
    played_types = {getattr(c, "card_color_type", None) for c in player.played_cards if c is not None and getattr(c, "card_color_type", None)}
    only_next_to = (meta or {}).get("only_playable_next_to") or []
    only_terrains = (meta or {}).get("only_playable_on_terrains") or []
    for t in game.board.to_list():
        if game.board.can_place_for_player(
            t["row"], t["col"], tile_type,
            played_card_types=played_types,
            only_playable_next_to=only_next_to,
            only_playable_on_terrains=only_terrains,
        ):
            if money_after_card is not None:
                fee_info = _placement_fee_options(player.player_id, t["row"], t["col"], meta)
                fee_amt = int(fee_info["amount"]) if fee_info else 0
                if money_after_card < fee_amt:
                    continue
            return True
    return False


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
TILE_TYPE_FILE    = CARDS_DIR.parent / "tile_type.yaml"

if BOARD_CONFIG_FILE.exists():
    with open(BOARD_CONFIG_FILE) as _f:
        _cfg = yaml.safe_load(_f) or []
    game.board.load_config(_cfg)

# ── Tile-type config (terrain-level defaults) ────────────────
_tile_type_config: dict = {}
if TILE_TYPE_FILE.exists():
    with open(TILE_TYPE_FILE) as _f:
        _tile_type_config = yaml.safe_load(_f) or {}

def _save_tile_type_config():
    with open(TILE_TYPE_FILE, "w") as _f:
        yaml.dump(_tile_type_config, _f,
                  default_flow_style=False, allow_unicode=True, sort_keys=False)

CARD_TYPE_FILES = {
    "company": "company.yaml",
    "platform": "platform.yaml",
    "cyber_attack": "cyber_attacks.yaml",
    "fuck_up": "fuck_ups.yaml",
    "leverage": "leverage.yaml",
    "innovation": "innovation.yaml",
    "build": "build.yaml",
    "regulation": "regulation.yaml",
    "world_event": "world_event.yaml",
}

# Canonical file order for globally sequential ID assignment.
# IDs run 1, 2, 3... across all files in this order.
FILE_ORDER = ["company", "platform", "cyber_attack", "fuck_up", "leverage", "innovation", "build", "regulation", "world_event"]


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
        player.pending_tile_queue = []
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

    _check_all_drafted_and_hired()


@socketio.on("submit_hiring")
def on_submit_hiring(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase not in (Phase.YEAR_START_DRAFT, Phase.HIRING):
        return
    player = game.players.get(player_id)
    if not player or player.hiring_done:
        return
    if game.phase == Phase.YEAR_START_DRAFT and not player.ready:
        emit("error", {"message": "Finish drafting before hiring."})
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

    _check_all_drafted_and_hired()


def _check_all_drafted_and_hired():
    """Once every player has both drafted and hired, finalize and move on."""
    if not game.all_drafts_done():
        return
    if not all(p.hiring_done for p in game.players.values()):
        return
    game.finalize_draft()
    _begin_player_turns()


def _begin_player_turns():
    game.phase = Phase.PLAYER_TURNS
    game.clear_ready()
    game.current_turn_index = game.dealer_index
    for player in game.players.values():
        player.reset_turn()
        player.year_done = False

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
    if not game.all_regulation_resolved():
        return
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if game.all_court_players_ready():
        # No court players at all — auto-advance
        game.advance_past_regulation()
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
    else:
        # Court players still need to click Start Year.
        # Broadcast to the whole room (so other players see the waiting state)
        # AND emit directly to each court player's SID so the button is guaranteed.
        court_pids = [p.player_id for p in game.court_players()]
        socketio.emit("regulation_all_resolved", {"court_player_ids": court_pids}, room="game")
        for sid, pid in connected_players.items():
            if pid in court_pids:
                socketio.emit("prompt_start_year", {}, room=sid)


@socketio.on("start_year_after_regulation")
def on_start_year_after_regulation():
    if game.phase != Phase.REGULATION:
        return
    if not game.all_regulation_resolved():
        return
    player_id = connected_players.get(request.sid)
    player = game.players.get(player_id)
    if not player or not player.went_to_court:
        emit("error", {"message": "Only players who went to court can start the year."})
        return
    player.court_start_ready = True
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if game.all_court_players_ready():
        game.advance_past_regulation()
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()


def _send_regulation_alerts():
    if not game.current_regulation:
        return
    reg = game.current_regulation

    if reg.card_type == "world_event":
        results = game.resolve_world_event()
        for sid, player_id in connected_players.items():
            r = results.get(player_id, {})
            socketio.emit("world_event_resolved", {
                "event": reg.to_dict(),
                "global_applied": r.get("global_applied", {}),
                "conditional_met": r.get("conditional_met", False),
                "conditional_applied": r.get("conditional_applied", {}),
            }, room=sid)
        return

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
            "card_type": reg.card_type,
            "compliance": reg.compliance if affected else {},
            "court_penalty": reg.court_penalty if affected else {},
            "court_threshold": reg.court_threshold,
            "effective_court_threshold": game.effective_court_threshold(player_id) if affected else reg.court_threshold,
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

    if player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
        return

    if player.has_pending_fuckups():
        if card.card_type != "fuck_up":
            emit("error", {"message": "You have fuck-up cards — they are the ONLY thing you can play this turn."})
            return
        removed = player.remove_from_hand(card_name)
        if removed:
            player.apply_card_effects(removed, game)
            game.discard_pile.append(removed)
            _handle_lose_card_rule(player, removed)

        if player.pending_card_loss or player.has_pending_fuckups():
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
        else:
            _advance_to_next_or_end_year()
        _check_win_condition()
        return

    cpt = P("cards_per_turn", 2)
    if player.cards_played_this_turn >= cpt:
        emit("error", {"message": f"You can only play {cpt} cards per turn."})
        return

    use_optional = data.get("use_optional") or {}
    pay_to = data.get("pay_to") or {}
    use_responsible_mining = bool(data.get("responsible_mining"))
    req_err = player.check_requirements(card)
    if req_err:
        emit("error", {"message": req_err})
        return

    build_tiles = _card_build_types(card)

    # Validate responsible-mining extra cost if chosen
    if use_responsible_mining and card.responsible_mining:
        extra_cost = card.responsible_mining.get("extra_cost") or {}
        for res, amt in extra_cost.items():
            if player.resources.get(res, 0) < amt:
                emit("error", {"message": f"Not enough {res} for responsible mining (need {amt} extra)."})
                return

    err = player.can_afford_costs(card, use_optional)
    if err:
        emit("error", {"message": err})
        return
    # If this card creates build tile placement, ensure at least one legal placement exists
    # before allowing the card to be played (prevents stuck pending-tile states).
    if build_tiles:
        tile_meta = {
            "only_playable_next_to": card.only_playable_next_to or [],
            "only_playable_on_terrains": card.only_playable_on_terrains or [],
            "adjacent_placement_fee": card.adjacent_placement_fee or 0,
            "adjacent_placement_fee_target_types": card.adjacent_placement_fee_target_types or [],
        }
        money_after_card = (player.resources.get("money", 0) - _money_cost_for_card_play(player, card))
        for bt in build_tiles:
            if not _has_any_legal_tile_placement(player, bt, tile_meta, money_after_card=money_after_card):
                emit("error", {"message": _placement_error_hint(bt, tile_meta)})
                return
    player.pay_costs(card, use_optional)

    # Apply responsible-mining extra cost and bonus effect
    if use_responsible_mining and card.responsible_mining:
        for res, amt in (card.responsible_mining.get("extra_cost") or {}).items():
            player.resources[res] = player.resources.get(res, 0) - amt
        for res, amt in (card.responsible_mining.get("extra_effect") or {}).items():
            player.resources[res] = player.resources.get(res, 0) + amt

    if card.fee and not player._owns_fee_card(card):
        # Fee already deducted via pay_costs(). Transfer it to the chosen payee
        # only when the target is valid.  If absent (bank or no eligible player),
        # nothing is transferred.
        fee_target = pay_to.get("fee")
        if fee_target and fee_target in game.players and fee_target != player_id:
            target_player = game.players[fee_target]
            eligible = False
            if card.fee_card_id:
                eligible = any(getattr(c, "id", None) == card.fee_card_id for c in target_player.played_cards if c is not None)
            elif card.fee_card_type:
                eligible = any(getattr(c, "card_color_type", None) == card.fee_card_type for c in target_player.played_cards if c is not None)
            elif card.fee_company_type:
                eligible = bool(
                    target_player.company and
                    target_player.company.card_color_type == card.fee_company_type
                )
            if eligible:
                target_player.resources["money"] = (
                    target_player.resources.get("money", 0) + card.fee
                )

    played = player.play_card(card_name, game)
    if not played:
        emit("error", {"message": f"Failed to play '{card_name}' — card not found in hand."})
        return

    # Notify all players that a card was played
    socketio.emit("card_played_notification", {
        "player_name": player.name,
        "player_id": player_id,
        "card_name": card_name,
        "card": played.to_dict(),
    }, room="game")

    if build_tiles:
        player.pending_tile = build_tiles[0]
        player.pending_tile_queue = list(build_tiles[1:])
        player.pending_tile_meta = {
            "only_playable_next_to": card.only_playable_next_to or [],
            "only_playable_on_terrains": card.only_playable_on_terrains or [],
            "bonuses_by_placing_next_to_building": card.bonuses_by_placing_next_to_building or [],
            "bonuses_by_building_on_terrain_type": card.bonuses_by_building_on_terrain_type or [],
            "bonuses_by_building_adjacent_to_terrain_type": card.bonuses_by_building_adjacent_to_terrain_type or [],
            "placed_tile_adjacency_bonuses": card.placed_tile_adjacency_bonuses or [],
            "adjacent_placement_fee": card.adjacent_placement_fee or 0,
            "adjacent_placement_fee_target_types": card.adjacent_placement_fee_target_types or [],
        }
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
        _check_win_condition()
        return

    _handle_steal_card(player, played)
    _handle_poach_employees(player, played)

    if player.pending_card_steal or player.pending_poach:
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
    elif not _maybe_auto_end_turn(player):
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
    _check_win_condition()


@socketio.on("play_build_card")
def on_play_build_card(data):
    """Play a card from the shared build row (counts toward cards_per_turn limit)."""
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
    if player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
        return

    cpt = P("cards_per_turn", 2)
    if player.cards_played_this_turn >= cpt:
        emit("error", {"message": f"You can only play {cpt} cards per turn."})
        return

    row_index = data.get("row_index")
    if row_index is None or row_index < 0 or row_index >= len(game.shared_build_row):
        emit("error", {"message": "Invalid build row index."})
        return

    card = game.shared_build_row[row_index]
    if card is None:
        emit("error", {"message": "No card in that slot."})
        return

    # Check requirements and costs
    req_err = player.check_requirements(card)
    if req_err:
        emit("error", {"message": req_err})
        return
    build_tiles = _card_build_types(card)
    err = player.can_afford_costs(card, {})
    if err:
        emit("error", {"message": err})
        return

    # Green upgrade: if player chose to pay fee_for_green, check extra affordability
    green_upgrade = bool(data.get("green_upgrade", False))
    fee_for_green = getattr(card, "fee_for_green", None) or {}
    if green_upgrade and fee_for_green:
        for res, amount in fee_for_green.items():
            have = player.resources.get(res, 0)
            if have < amount:
                emit("error", {"message": f"Cannot afford green upgrade: need {amount} {res} (have {have})."})
                return
    if build_tiles:
        tile_meta = {
            "only_playable_next_to": card.only_playable_next_to or [],
            "only_playable_on_terrains": card.only_playable_on_terrains or [],
            "adjacent_placement_fee": card.adjacent_placement_fee or 0,
            "adjacent_placement_fee_target_types": card.adjacent_placement_fee_target_types or [],
        }
        money_after_card = (player.resources.get("money", 0) - _money_cost_for_card_play(player, card))
        for bt in build_tiles:
            if not _has_any_legal_tile_placement(player, bt, tile_meta, money_after_card=money_after_card):
                emit("error", {"message": _placement_error_hint(bt, tile_meta)})
                return

    try:
        # Snapshot state so any runtime error cannot leave a half-applied build play.
        resources_before = dict(player.resources)
        production_before = dict(player.production)
        users_before = player.users
        played_before = list(player.played_cards)
        cards_played_before = player.cards_played_this_turn
        pending_tile_before = player.pending_tile
        pending_queue_before = list(player.pending_tile_queue)
        pending_meta_before = dict(player.pending_tile_meta or {})
        shared_row_before = list(game.shared_build_row)
        build_deck_before = list(game.build_deck)

        player.pay_costs(card, {})

        # Deduct green upgrade fee and mark card as green
        if green_upgrade and fee_for_green:
            for res, amount in fee_for_green.items():
                player.resources[res] = player.resources.get(res, 0) - amount
            card._effective_pollution_tag = "green"

        # Remove from shared row and refill slot
        game.shared_build_row[row_index] = None
        game._refill_build_row()

        # Apply card effects (move to played_cards, apply effects)
        card.deck = "build"
        player.played_cards.append(card)
        player.apply_card_effects(card, game)
        player.cards_played_this_turn += 1
        if card.tiers:
            card.current_tier = 1

        socketio.emit("card_played_notification", {
            "player_name": player.name,
            "player_id": player_id,
            "card_name": card.name,
            "card": card.to_dict(),
        }, room="game")

        if build_tiles:
            player.pending_tile = build_tiles[0]
            player.pending_tile_queue = list(build_tiles[1:])
            player.pending_tile_meta = {
                "only_playable_next_to": card.only_playable_next_to or [],
                "only_playable_on_terrains": card.only_playable_on_terrains or [],
                "bonuses_by_placing_next_to_building": card.bonuses_by_placing_next_to_building or [],
                "bonuses_by_building_on_terrain_type": card.bonuses_by_building_on_terrain_type or [],
                "bonuses_by_building_adjacent_to_terrain_type": card.bonuses_by_building_adjacent_to_terrain_type or [],
                "placed_tile_adjacency_bonuses": card.placed_tile_adjacency_bonuses or [],
                "adjacent_placement_fee": card.adjacent_placement_fee or 0,
                "adjacent_placement_fee_target_types": card.adjacent_placement_fee_target_types or [],
            }
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
            _check_win_condition()
            return

        # No tile to place — auto-end if action limit reached, else let player decide
        if not _maybe_auto_end_turn(player):
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
        _check_win_condition()

    except Exception as exc:
        # Rollback local mutations done in this handler.
        player.resources = resources_before
        player.production = production_before
        player.users = users_before
        player.played_cards = played_before
        player.cards_played_this_turn = cards_played_before
        player.pending_tile = pending_tile_before
        player.pending_tile_queue = pending_queue_before
        player.pending_tile_meta = pending_meta_before
        game.shared_build_row = shared_row_before
        game.build_deck = build_deck_before
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
        traceback.print_exc()
        emit("error", {"message": f"Build card error: {exc}"})


@socketio.on("produce_item")
def on_produce_item(data):
    """Produce a craftable item from a played card (e.g. a satellite)."""
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
        emit("error", {"message": "Place your pending tile on the board first."})
        return
    if player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
        return

    instance_id = data.get("instance_id")
    item_index = int(data.get("item_index", -1))

    card = next(
        (c for c in player.played_cards if c is not None and c._instance_id == instance_id),
        None,
    )
    if not card:
        emit("error", {"message": "Card not found in your played cards."})
        return

    producibles = getattr(card, "producibles", []) or []
    if item_index < 0 or item_index >= len(producibles):
        emit("error", {"message": "Invalid producible index."})
        return

    item = producibles[item_index]
    build_type = (item.get("build") or "").replace(" ", "_").lower()
    cost = item.get("cost") or {}
    fee = int(item.get("fee") or 0)
    fee_card_type = (item.get("fee_card_type") or "").strip() or None
    requires_placed = (item.get("requires_placed_build") or "").replace(" ", "_").lower() or None
    only_next_to = item.get("only_playable_next_to") or []
    only_on_terrains = item.get("only_playable_on_terrains") or []

    if not build_type:
        emit("error", {"message": "Producible has no build type configured."})
        return

    # ── Once-per-year-per-producible check ────────────────────────
    if card._producibles_used:
        emit("error", {"message": f"You already produced from this card this year. Only one producible per card per year."})
        return

    # ── Check requires_placed_build ──────────────────────────────
    if requires_placed:
        has_tile = any(
            t.get("placed_tile") and
            (t["placed_tile"].get("type") or "").replace(" ", "_").lower() == requires_placed and
            t["placed_tile"].get("owner_id") == player_id
            for t in game.board._tiles.values()
        )
        if not has_tile:
            label = requires_placed.replace("_", " ")
            emit("error", {"message": f"You must have a {label} placed on the board first."})
            return

    # ── Check whether player owns the fee card (pays fee to themselves → free) ──
    owns_fee_card = fee_card_type and any(
        (getattr(c, "card_color_type", None) or "") == fee_card_type
        for c in player.played_cards if c is not None
    )
    effective_fee = 0 if owns_fee_card else fee

    # ── Affordability checks ─────────────────────────────────────
    money_needed = cost.get("money", 0) + effective_fee
    if player.resources.get("money", 0) < money_needed:
        emit("error", {"message": f"Not enough money (need {money_needed}, have {player.resources.get('money', 0)})."})
        return
    for res, amount in cost.items():
        if res == "money":
            continue  # already checked above with fee
        if player.resources.get(res, 0) < amount:
            emit("error", {"message": f"Not enough {res} (need {amount})."})
            return

    # ── Check a legal tile placement exists ──────────────────────
    tile_meta = {
        "only_playable_next_to": only_next_to,
        "only_playable_on_terrains": only_on_terrains,
        "adjacent_placement_fee": 0,
        "adjacent_placement_fee_target_types": [],
    }
    money_after = player.resources.get("money", 0) - money_needed
    if not _has_any_legal_tile_placement(player, build_type, tile_meta, money_after_card=money_after):
        emit("error", {"message": _placement_error_hint(build_type, tile_meta)})
        return

    # ── Deduct cost ──────────────────────────────────────────────
    for res, amount in cost.items():
        player.resources[res] = player.resources.get(res, 0) - amount

    # ── Pay fee ──────────────────────────────────────────────────
    if effective_fee > 0:
        player.resources["money"] = player.resources.get("money", 0) - effective_fee
        pay_to = data.get("pay_to")
        if pay_to and pay_to in game.players and pay_to != player_id:
            target_player = game.players[pay_to]
            if fee_card_type and any(
                (getattr(c, "card_color_type", None) or "") == fee_card_type
                for c in target_player.played_cards if c is not None
            ):
                target_player.resources["money"] = target_player.resources.get("money", 0) + effective_fee

    # ── Apply immediate / production bonuses ─────────────────────
    for res, amt in (item.get("immediate") or {}).items():
        if res == "users":
            player.gain_users(amt, game)
        else:
            pool = getattr(player, player._get_pool(res))
            pool[res] = pool.get(res, 0) + amt
    for res, amt in (item.get("production") or {}).items():
        player.production[res] = player.production.get(res, 0) + amt

    # ── Mark producible as used this year ────────────────────────
    card._producibles_used.add(item_index)

    # ── Queue pending tile ────────────────────────────────────────
    player.pending_tile = build_type
    player.pending_tile_queue = []
    player.pending_tile_meta = {
        "only_playable_next_to": only_next_to,
        "only_playable_on_terrains": only_on_terrains,
        "bonuses_by_placing_next_to_building": [],
        "bonuses_by_building_on_terrain_type": [],
        "bonuses_by_building_adjacent_to_terrain_type": [],
        "placed_tile_adjacency_bonuses": [],
        "adjacent_placement_fee": 0,
        "adjacent_placement_fee_target_types": [],
    }

    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_win_condition()


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


@socketio.on("upgrade_card_tier")
def on_upgrade_card_tier(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    if game.phase != Phase.PLAYER_TURNS:
        emit("error", {"message": "Tier upgrades can only be purchased during the Player Turns phase."})
        return
    if player_id != game.current_player_id:
        emit("error", {"message": "It's not your turn."})
        return
    player = game.players.get(player_id)
    if not player:
        return
    if player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
        return
    instance_id = data.get("instance_id", "")
    result = player.upgrade_card_tier(instance_id, game)
    if result["ok"]:
        player.cards_played_this_turn += 1
        socketio.emit("game_state", game.to_dict(), room="game")
        _send_private_states()
        _check_win_condition()
        _maybe_auto_end_turn(player)
    else:
        emit("error", {"message": result["error"]})


def _handle_lose_card_rule(player, fuckup_card):
    """Process the lose_card_rule on a played fuck-up card."""
    rule = getattr(fuckup_card, "lose_card_rule", None)
    if not rule:
        return
    mode = rule.get("mode", "least_users")
    target_types = rule.get("target_types") or []
    eligible = player.get_eligible_cards_to_lose(target_types)
    if not eligible:
        return
    if mode == "least_users":
        victim = player.find_least_users_card(target_types)
        if victim:
            player.lose_played_card(victim, game)
            game.discard_pile.append(victim)
    elif mode == "player_choice":
        player.pending_card_loss = {
            "eligible_instance_ids": [c._instance_id for c in eligible],
            "fuckup_name": fuckup_card.name,
        }


@socketio.on("choose_card_to_lose")
def on_choose_card_to_lose(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    player = game.players.get(player_id)
    if not player or not player.pending_card_loss:
        emit("error", {"message": "You don't have a pending card loss."})
        return
    instance_id = data.get("instance_id", "")
    allowed = player.pending_card_loss.get("eligible_instance_ids", [])
    if instance_id not in allowed:
        emit("error", {"message": "That card is not eligible to be lost."})
        return
    victim = next((c for c in player.played_cards if c._instance_id == instance_id), None)
    if not victim:
        emit("error", {"message": "Card not found."})
        return
    player.lose_played_card(victim, game)
    game.discard_pile.append(victim)
    player.pending_card_loss = None

    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()

    if not player.has_pending_fuckups():
        _advance_to_next_or_end_year()


def _handle_steal_card(player, card):
    """Leverage: player steals a card from an opponent's hand."""
    if not getattr(card, "steal_card", False):
        return
    opponents = []
    for pid, p in game.players.items():
        if pid == player.player_id:
            continue
        hand = [c for c in p.hand if c.card_type != "fuck_up"]
        if hand:
            opponents.append({"id": pid, "name": p.name, "cards": [c.to_dict() for c in hand]})
    if not opponents:
        return
    player.pending_card_steal = {"card_name": card.name}
    player_sid = next((s for s, pid in connected_players.items() if pid == player.player_id), None)
    if player_sid:
        socketio.emit("steal_card_prompt", {
            "card_name": card.name,
            "opponents": opponents,
        }, room=player_sid)


@socketio.on("choose_card_to_steal")
def on_choose_card_to_steal(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    player = game.players.get(player_id)
    if not player or not player.pending_card_steal:
        emit("error", {"message": "No pending steal."})
        return
    victim_id = data.get("victim_id", "")
    instance_id = data.get("instance_id", "")
    victim = game.players.get(victim_id)
    if not victim or victim_id == player_id:
        emit("error", {"message": "Invalid target."})
        return
    stolen = next((c for c in victim.hand if c._instance_id == instance_id and c.card_type != "fuck_up"), None)
    if not stolen:
        emit("error", {"message": "Card not found in target's hand."})
        return
    victim.hand = [c for c in victim.hand if c._instance_id != instance_id]
    player.hand.append(stolen)
    player.pending_card_steal = None
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if not player.pending_poach:
        _maybe_auto_end_turn(player)


@socketio.on("skip_steal")
def on_skip_steal():
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    player = game.players.get(player_id)
    if not player or not player.pending_card_steal:
        return
    player.pending_card_steal = None
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if not player.pending_poach:
        _maybe_auto_end_turn(player)


def _handle_poach_employees(player, card):
    """Leverage: player poaches employees from an opponent."""
    pe = getattr(card, "poach_employees", None)
    if not pe or not pe.get("max"):
        return
    opponents = []
    for pid, p in game.players.items():
        if pid == player.player_id:
            continue
        eng = p.resources.get("engineers", 0)
        suits = p.resources.get("suits", 0)
        if eng + suits > 0:
            opponents.append({"id": pid, "name": p.name, "engineers": eng, "suits": suits})
    if not opponents:
        return
    player.pending_poach = {"card_name": card.name, "max": pe["max"], "price": pe.get("price", 0)}
    player_sid = next((s for s, pid in connected_players.items() if pid == player.player_id), None)
    if player_sid:
        socketio.emit("poach_prompt", {
            "card_name": card.name,
            "max": pe["max"],
            "price": pe.get("price", 0),
            "opponents": opponents,
        }, room=player_sid)


@socketio.on("confirm_poach")
def on_confirm_poach(data):
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id or game.phase != Phase.PLAYER_TURNS:
        return
    player = game.players.get(player_id)
    if not player or not player.pending_poach:
        emit("error", {"message": "No pending poach."})
        return
    victim_id = data.get("victim_id", "")
    victim = game.players.get(victim_id)
    if not victim or victim_id == player_id:
        emit("error", {"message": "Invalid target."})
        return
    max_total = player.pending_poach["max"]
    price = player.pending_poach.get("price", 0)
    eng_take = max(0, int(data.get("engineers", 0)))
    suits_take = max(0, int(data.get("suits", 0)))
    if eng_take + suits_take > max_total:
        emit("error", {"message": f"You can poach at most {max_total} employees."})
        return
    if eng_take + suits_take == 0:
        emit("error", {"message": "Select at least one employee to poach."})
        return
    eng_take = min(eng_take, victim.resources.get("engineers", 0))
    suits_take = min(suits_take, victim.resources.get("suits", 0))
    total_cost = (eng_take + suits_take) * price
    if price > 0 and player.resources.get("money", 0) < total_cost:
        emit("error", {"message": f"Not enough money. Need ${total_cost}B."})
        return
    victim.resources["engineers"] = victim.resources.get("engineers", 0) - eng_take
    victim.resources["suits"] = victim.resources.get("suits", 0) - suits_take
    player.resources["engineers"] = player.resources.get("engineers", 0) + eng_take
    player.resources["suits"] = player.resources.get("suits", 0) + suits_take
    if total_cost > 0:
        player.resources["money"] = player.resources.get("money", 0) - total_cost
    player.pending_poach = None
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if not player.pending_card_steal:
        _maybe_auto_end_turn(player)


@socketio.on("skip_poach")
def on_skip_poach():
    _touch_activity()
    player_id = connected_players.get(request.sid)
    if not player_id:
        return
    player = game.players.get(player_id)
    if not player or not player.pending_poach:
        return
    player.pending_poach = None
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    if not player.pending_card_steal:
        _maybe_auto_end_turn(player)


def _maybe_auto_end_turn(player):
    """Auto-advance after playing if the card limit is reached and no tile is pending."""
    cpt = P("cards_per_turn", 2)
    if (player.cards_played_this_turn >= cpt
            and not player.pending_tile
            and not player.has_pending_fuckups()
            and not player.pending_card_loss
            and not player.pending_card_steal
            and not player.pending_poach):
        _advance_to_next_or_end_year()
        return True
    return False


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
    if player and player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player and player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player and player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
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
    if player.pending_card_loss:
        emit("error", {"message": "You must choose a card to lose first."})
        return
    if player.pending_card_steal:
        emit("error", {"message": "You must complete your IP theft first."})
        return
    if player.pending_poach:
        emit("error", {"message": "You must complete employee poaching first."})
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
    bankrupt = game.end_current_year()
    for pid, pname in bankrupt:
        socketio.emit("player_bankrupt", {"player_name": pname}, room="game")
    if game.phase == Phase.REGULATION:
        _send_regulation_alerts()
    socketio.emit("game_state", game.to_dict(), room="game")
    _send_private_states()
    _check_win_condition()


# ── Board ────────────────────────────────────────────────────

@socketio.on("get_board")
def on_get_board():
    emit("board_state", game.board.to_list())
    emit("tile_type_config", _tile_type_config)


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

    # Check tile requirements against player's played card subtypes (card_color_type = "social platform", etc.)
    played_types = {getattr(c, "card_color_type", None) for c in player.played_cards if c is not None and getattr(c, "card_color_type", None)}
    if not game.board.player_meets_requirements(row, col, played_types):
        tile = game.board.get_tile(row, col)
        reqs = tile.get("requirements", []) if tile else []
        emit("error", {"message": f"You need to have played a card of type: {', '.join(reqs)}"})
        return

    meta = player.pending_tile_meta or {}
    placement_fee = _placement_fee_options(player_id, row, col, meta)
    pay_to = (data.get("pay_to") or {}).get("placement_fee")
    if placement_fee:
        payees = placement_fee["payees"]
        fee_amt = int(placement_fee["amount"])
        if player.resources.get("money", 0) < fee_amt:
            emit("error", {"message": f"Not enough money to place here — placement fee is ${fee_amt}B."})
            return
        if not pay_to:
            emit("placement_fee_required", {
                "row": row,
                "col": col,
                "amount": fee_amt,
                "payees": [{"pid": pid, "name": game.players[pid].name} for pid in payees if pid in game.players],
            })
            return
        if pay_to not in payees:
            emit("error", {"message": "Selected placement fee payee is not eligible for this placement."})
            return
        player.resources["money"] = player.resources.get("money", 0) - fee_amt
        game.players[pay_to].resources["money"] = game.players[pay_to].resources.get("money", 0) + fee_amt

    bonuses = game.board.place_tile(
        row, col, player.pending_tile, player_id,
        only_playable_next_to=meta.get("only_playable_next_to") or [],
        only_playable_on_terrains=meta.get("only_playable_on_terrains") or [],
        bonuses_by_placing_next_to_building=meta.get("bonuses_by_placing_next_to_building") or [],
        bonuses_by_building_on_terrain_type=meta.get("bonuses_by_building_on_terrain_type") or [],
        bonuses_by_building_adjacent_to_terrain_type=meta.get("bonuses_by_building_adjacent_to_terrain_type") or [],
        placed_tile_adjacency_bonuses=meta.get("placed_tile_adjacency_bonuses") or [],
    )
    if not bonuses:
        emit("error", {"message": "Cannot place a tile there."})
        return

    users_before_tile = player.users
    for res, amt in bonuses.get("immediate", {}).items():
        if res == "users":
            player.gain_users(amt, game)
        elif res in _PRODUCTION_ONLY_KEYS:
            # Some terrain/tile bonuses historically store HR/DC/ads in "immediate".
            # Treat those as production increments so gameplay matches expectations.
            player.production[res] = player.production.get(res, 0) + amt
        else:
            player.resources[res] = player.resources.get(res, 0) + amt
    for res, amt in bonuses.get("production", {}).items():
        player.production[res] = player.production.get(res, 0) + amt
    users_gained_tile = player.users - users_before_tile
    if users_gained_tile > 0:
        mod = player.reputation_modifier()
        if mod != 0:
            delta = max(-users_gained_tile, mod)
            player.users += delta
            if delta > 0:
                game.user_pool = max(0, game.user_pool - delta)

    tile_type = player.pending_tile
    current_meta = player.pending_tile_meta or {}
    player.pending_tile = None
    player.pending_tile_meta = {}

    if player.pending_tile_queue:
        # Advance to next queued tile only if a legal placement exists now.
        while player.pending_tile_queue:
            nxt = player.pending_tile_queue.pop(0)
            if _has_any_legal_tile_placement(
                player, nxt, current_meta,
                money_after_card=player.resources.get("money", 0),
            ):
                player.pending_tile = nxt
                player.pending_tile_meta = dict(current_meta)
                break
            emit("error", {"message": f"No legal board placement available for queued tile: {nxt.replace('_', ' ')}. Skipping it."})
    elif player._remaining_starting_tiles:
        player.pending_tile = player._remaining_starting_tiles.pop(0)

    bonus_text = []
    for res, amt in bonuses.get("immediate", {}).items():
        bonus_text.append(f"+{amt} {res}")
    for res, amt in bonuses.get("production", {}).items():
        bonus_text.append(f"+{amt} {res}/yr")

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
        if not _maybe_auto_end_turn(player):
            socketio.emit("game_state", game.to_dict(), room="game")
            _send_private_states()
    _check_win_condition()


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
    emit("tile_type_config", _tile_type_config)


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
    requirements = data.get("requirements") or []
    # only_build: None=all allowed, []=none, [...]= whitelist
    # Use key-existence check so None (all allowed) is distinguished from "not provided"
    if "only_build" in data:
        only_build = data["only_build"]   # explicitly provided, may be None/[]/[...]
    else:
        from server.models.board import _UNSET as _OB_UNSET
        only_build = _OB_UNSET             # sentinel: don't touch the existing value
    if not game.board.set_tile_terrain(
        row, col, terrain, name, build_bonuses, adjacency_bonuses, requirements, only_build
    ):
        emit("error", {"message": "Invalid tile or terrain type."})
        return
    _save_board_config()
    board_data = game.board.to_list()
    for sid in editor_sids:
        socketio.emit("board_editor_data", board_data, room=sid)
    if game.started:
        socketio.emit("board_update", board_data, room="game")


@socketio.on("edit_board_terrain_type")
def on_edit_board_terrain_type(data):
    """Save terrain-type defaults to tile_type.yaml.
    Also applies the settings to any existing board tiles of that terrain
    so bonus calculations stay consistent."""
    if request.sid not in editor_sids:
        return
    terrain = data.get("terrain")
    from server.models.board import _UNSET as _OB_UNSET
    only_build        = data["only_build"] if "only_build" in data else _OB_UNSET
    requirements      = data.get("requirements")
    build_bonuses     = data.get("build_bonuses")
    adjacency_bonuses = data.get("adjacency_bonuses")
    if not terrain:
        return

    # ── 1. Persist in tile_type.yaml ──────────────────────────
    entry = _tile_type_config.get(terrain, {})
    if only_build is not _OB_UNSET:
        entry["only_build"] = only_build
    if requirements is not None:
        entry["requirements"] = requirements
    if build_bonuses is not None:
        entry["build_bonuses"] = build_bonuses
    if adjacency_bonuses is not None:
        entry["adjacency_bonuses"] = adjacency_bonuses
    _tile_type_config[terrain] = entry
    _save_tile_type_config()

    # ── 2. Also apply to existing board tiles ─────────────────
    game.board.set_terrain_type_properties(
        terrain,
        only_build=only_build,
        requirements=requirements,
        build_bonuses=build_bonuses,
        adjacency_bonuses=adjacency_bonuses,
    )
    _save_board_config()

    # ── 3. Broadcast updated state ────────────────────────────
    board_data = game.board.to_list()
    for sid in editor_sids:
        socketio.emit("board_editor_data", board_data, room=sid)
        socketio.emit("tile_type_config", _tile_type_config, room=sid)
    if game.started:
        socketio.emit("board_update", board_data, room="game")
        socketio.emit("tile_type_config", _tile_type_config, room="game")


@socketio.on("set_placed_tile_editor")
def on_set_placed_tile_editor(data):
    if request.sid not in editor_sids:
        return
    row = data.get("row")
    col = data.get("col")
    tile_type = data.get("tile_type") or None  # None = clear
    if not game.board.set_placed_tile_editor(row, col, tile_type):
        emit("error", {"message": "Could not set tile type."})
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


def _check_win_condition():
    """Broadcast game_won if total captured users >= total_users threshold."""
    if not game.started or not game.players:
        return
    total_captured = sum(p.users for p in game.players.values())
    if total_captured < game.total_users:
        return
    winner = max(game.players.values(), key=lambda p: p.users)
    socketio.emit("game_won", {
        "winner_name": winner.name,
        "winner_users": winner.users,
        "scores": {p.name: p.users for p in game.players.values()},
    }, room="game")


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
                "hand": [c.to_dict() for c in player.hand if c is not None],
                "draft_pool": [c.to_dict() for c in player.draft_pool if c is not None],
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
                "pending_card_loss": player.pending_card_loss,
                "pending_card_steal": player.pending_card_steal,
                "pending_poach": player.pending_poach,
            }, room=sid)


# ── Card Editor ─────────────────────────────────────────────

def _read_all_cards_yaml() -> dict[str, list[dict]]:
    def _normalize_card_entry(card: dict) -> dict:
        c = dict(card or {})
        legacy_factory_refund = int(c.get("factory_refund", 0) or 0)
        legacy_dc_bonus = int(c.get("dc_production_bonus", 0) or 0)

        placed_adj = c.get("placed_tile_adjacency_bonuses")
        if not placed_adj:
            placed_adj = []
            if legacy_factory_refund > 0:
                placed_adj.append({
                    "build_type": "factory",
                    "production": {"money": legacy_factory_refund},
                })
            if legacy_dc_bonus > 0:
                placed_adj.append({
                    "build_type": "data_center",
                    "production": {"data_centers": legacy_dc_bonus},
                })
        c["placed_tile_adjacency_bonuses"] = placed_adj

        placing_adj = c.get("bonuses_by_placing_next_to_building") or []
        if not placing_adj and legacy_dc_bonus > 0:
            placing_adj = [{
                "build_type": "data_center",
                "production": {"data_centers": legacy_dc_bonus},
            }]
        c["bonuses_by_placing_next_to_building"] = placing_adj

        c.pop("factory_refund", None)
        c.pop("dc_production_bonus", None)
        if "play_thresholds" not in c:
            min_rep = c.pop("min_reputation", None)
            if min_rep is not None and min_rep != 0:
                c["play_thresholds"] = [{"key": "reputation", "min": int(min_rep)}]
            else:
                c["play_thresholds"] = []
        c.setdefault("conditional_effects", {})
        return c

    result = {}
    for card_type, filename in CARD_TYPE_FILES.items():
        filepath = CARDS_DIR / filename
        if not filepath.exists():
            result[card_type] = []
            continue
        with open(filepath) as f:
            raw_cards = yaml.safe_load(f) or []
            result[card_type] = [_normalize_card_entry(c) for c in raw_cards]
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


def _reassign_all_ids_globally() -> dict:
    """Assign globally sequential IDs (1, 2, 3...) across all card files in FILE_ORDER.
    Also updates every cross-reference (target_id, fee_card_id) in all files and the
    graveyard.  Returns the {old_id: new_id} mapping."""
    id_map: dict[int, int] = {}
    counter = 1
    all_file_data: list[tuple[Path, str, list[dict]]] = []

    for card_type in FILE_ORDER:
        filename = CARD_TYPE_FILES.get(card_type)
        if not filename:
            continue
        filepath = CARDS_DIR / filename
        if not filepath.exists():
            continue
        header, entries = _read_yaml_file(filepath)
        for entry in entries:
            old_id = entry.get("id")
            new_id = counter
            if isinstance(old_id, int) and old_id > 0 and old_id != new_id:
                id_map[old_id] = new_id
            entry["id"] = new_id
            counter += 1
        all_file_data.append((filepath, header, entries))

    # Remap cross-references in all entries (in-memory, before any writes)
    def _remap_refs(entry: dict) -> None:
        tid = entry.get("target_id")
        if isinstance(tid, list):
            entry["target_id"] = [id_map.get(t, t) for t in tid]
        elif isinstance(tid, int) and tid in id_map:
            entry["target_id"] = id_map[tid]
        costs = entry.get("costs") or {}
        fci = costs.get("fee_card_id")
        if isinstance(fci, int) and fci in id_map:
            costs["fee_card_id"] = id_map[fci]
            entry["costs"] = costs
        for boost in (entry.get("boosts") or []):
            btid = boost.get("target_id")
            if isinstance(btid, list):
                boost["target_id"] = [id_map.get(t, t) for t in btid]
            elif isinstance(btid, int) and btid in id_map:
                boost["target_id"] = id_map[btid]

    if id_map:
        for _, _, entries in all_file_data:
            for entry in entries:
                _remap_refs(entry)
        if GRAVEYARD_FILE.exists():
            grave = _read_graveyard()
            for entry in grave:
                _remap_refs(entry)
            _write_graveyard(grave)

    for filepath, header, entries in all_file_data:
        _write_yaml_file(filepath, header, entries)

    return id_map


def _build_card_trees() -> dict:
    """Build tree structures from card boost relationships (target_id and target_type)."""
    all_cards = _read_all_cards_yaml()
    card_by_id: dict[int, dict] = {}
    card_type_by_id: dict[int, str] = {}
    for card_type, cards in all_cards.items():
        for card in cards:
            cid = card.get("id", 0)
            if cid:
                card_by_id[cid] = card
                card_type_by_id[cid] = card_type

    # target_id trees: group boosters by the specific target card id
    target_to_boosters: dict[int, list[dict]] = {}
    # target_type trees: group boosters by a canonical key of sorted type strings
    type_key_to_boosters: dict[str, list[dict]] = {}
    type_key_to_types: dict[str, list] = {}   # key → original types value

    # fee connections: cards that pay fees to a target card (by id or type)
    target_to_fee_payers: dict[int, list[dict]] = {}
    type_key_to_fee_payers: dict[str, list[dict]] = {}

    booster_ids_with_connections: set[int] = set()
    platform_ids_with_connections: set[int] = set()

    for card_type, cards in all_cards.items():
        for card in cards:
            cid = card.get("id", 0)
            for boost in card.get("boosts") or []:
                # ── target_id branch ──────────────────────────────
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
                            "production": boost.get("production", {}),
                            "target_count": boost.get("target_count"),
                        })
                        booster_ids_with_connections.add(cid)
                        platform_ids_with_connections.add(tid)

                # ── target_type branch ────────────────────────────
                raw_tt = boost.get("target_type")
                if raw_tt:
                    types_list = raw_tt if isinstance(raw_tt, list) else [raw_tt]
                    key = "|".join(sorted(str(t) for t in types_list))
                    type_key_to_boosters.setdefault(key, []).append({
                        "card": card,
                        "card_type": card_type,
                        "bonus": boost.get("bonus", {}),
                        "production": boost.get("production", {}),
                        "target_count": boost.get("target_count"),
                    })
                    type_key_to_types[key] = raw_tt
                    booster_ids_with_connections.add(cid)

            # ── fee connections ───────────────────────────────
            costs = card.get("costs") or {}
            fee_amount = costs.get("fee", 0) or 0
            if fee_amount:
                fee_tid = costs.get("fee_card_id")
                fee_ct = costs.get("fee_card_type")
                fee_entry = {
                    "card": card,
                    "card_type": card_type,
                    "fee": fee_amount,
                }
                if fee_tid and int(fee_tid) in card_by_id:
                    target_to_fee_payers.setdefault(int(fee_tid), []).append(fee_entry)
                    platform_ids_with_connections.add(int(fee_tid))
                    booster_ids_with_connections.add(cid)
                elif fee_ct:
                    types_list = fee_ct if isinstance(fee_ct, list) else [fee_ct]
                    key = "|".join(sorted(str(t) for t in types_list))
                    type_key_to_fee_payers.setdefault(key, []).append(fee_entry)
                    if key not in type_key_to_types:
                        type_key_to_types[key] = types_list
                    booster_ids_with_connections.add(cid)

    trees = []
    # Card-id trees
    all_target_ids = set(target_to_boosters.keys()) | set(target_to_fee_payers.keys())
    for tid in all_target_ids:
        trees.append({
            "is_type_target": False,
            "target": card_by_id[tid],
            "target_card_type": card_type_by_id[tid],
            "boosters": target_to_boosters.get(tid, []),
            "fee_payers": target_to_fee_payers.get(tid, []),
        })
    # Type-label trees
    all_type_keys = set(type_key_to_boosters.keys()) | set(type_key_to_fee_payers.keys())
    for key in all_type_keys:
        trees.append({
            "is_type_target": True,
            "target_types": type_key_to_types[key],
            "boosters": type_key_to_boosters.get(key, []),
            "fee_payers": type_key_to_fee_payers.get(key, []),
        })

    platform_ids = {cid for cid, ct in card_type_by_id.items() if ct == "platform"}
    booster_types = {"leverage", "innovation"}
    booster_ids = {cid for cid, ct in card_type_by_id.items() if ct in booster_types}

    unconnected_platforms = len(platform_ids - platform_ids_with_connections)
    unconnected_boosters = len(booster_ids - booster_ids_with_connections)
    total_connections = sum(len(b) for b in target_to_boosters.values()) + \
                        sum(len(b) for b in type_key_to_boosters.values())
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
        "fee": 0, "fee_card_id": None, "fee_card_type": None, "fee_company_type": None,
    }
    _CATEGORY_TEMPLATES = {
        "company": {"name": "New Company", "id": _next_card_id(), "type": "",
                     "description": "", "image": None,
                     "starting_resources": {k: 0 for k in ["engineers", "suits", "ads", "money", "servers", "reputation", "users"]},
                     "starting_production": {"HR": 0, "data_centers": 0, "ad_campaigns": 0},
                     "starting_tiles": []},
        "regulation": {"name": "New Regulation", "id": _next_card_id(), "tag": "",
                        "description": "", "image": None, "targets_all": 1, "target_id": None,
                        "target_type": None, "compliance": {}, "court_penalty": {}, "court_threshold": 4},
        "world_event": {"name": "New World Event", "id": _next_card_id(), "tag": "",
                        "description": "", "image": None, "targets_all": 1, "target_id": None,
                        "target_type": None, "compliance": {}, "court_penalty": {}, "court_threshold": 4,
                        "effect": {}, "conditional_effects": {},
                        "requirements": [], "required_card_ids": [], "play_thresholds": []},
    }
    _DEFAULT = {"name": "New Card", "id": _next_card_id(), "image": None, "description": "",
                "type": "", "number": 1, "build": None, "costs": dict(_COSTS_TEMPLATE),
                "effect": {}, "boosts": [], "requirements": [], "required_card_ids": [], "play_thresholds": [],
                "only_playable_next_to": [],
                "only_playable_on_terrains": [],
                "bonuses_by_placing_next_to_building": [],
                "bonuses_by_building_on_terrain_type": [],
                "bonuses_by_building_adjacent_to_terrain_type": [],
                "placed_tile_adjacency_bonuses": [],
                "adjacent_placement_fee": 0,
                "adjacent_placement_fee_target_types": [],
                "tiers": [],
                "producibles": [],
                "pollution_tag": "neutral",
                "fee_for_green": None,
                "lose_card_rule": None,
                "court_threshold_modifier": None}

    new_card = _CATEGORY_TEMPLATES.get(card_type, dict(_DEFAULT))
    if "id" not in new_card or new_card["id"] == 0:
        new_card["id"] = _next_card_id()

    entries.append(new_card)
    new_index = len(entries) - 1
    _write_yaml_file(filepath, header, entries)
    _reassign_all_ids_globally()   # new card + all subsequent files get correct IDs

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


@socketio.on("reorder_cards")
def on_reorder_cards(data):
    if request.sid not in editor_sids:
        return
    card_type = data.get("card_type")
    from_idx = data.get("from_index")
    to_idx = data.get("to_index")
    filename = CARD_TYPE_FILES.get(card_type)
    if not filename or from_idx is None or to_idx is None or from_idx == to_idx:
        return
    filepath = CARDS_DIR / filename
    header, entries = _read_yaml_file(filepath)
    if not (0 <= from_idx < len(entries) and 0 <= to_idx < len(entries)):
        return
    # Check no locks are held on the cards being moved
    for key in (f"{card_type}:{from_idx}", f"{card_type}:{to_idx}"):
        if key in locked_cards and locked_cards[key] != request.sid:
            emit("editor_error", {"message": "A card being moved is locked by another editor."})
            return
    entry = entries.pop(from_idx)
    entries.insert(to_idx, entry)
    _write_yaml_file(filepath, header, entries)   # persist reorder before global reassign
    _reassign_all_ids_globally()
    # Clear all positional locks for this file — indices shifted, locks are stale
    for key in list(locked_cards.keys()):
        if key.startswith(f"{card_type}:"):
            locked_cards.pop(key, None)
    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)


@socketio.on("set_card_disabled")
def on_set_card_disabled(data):
    """Toggle the disabled flag on a card without requiring a lock."""
    if request.sid not in editor_sids:
        return
    card_type = data.get("card_type")
    index = data.get("index")
    disabled = bool(data.get("disabled"))
    filename = CARD_TYPE_FILES.get(card_type)
    if not filename:
        return
    filepath = CARDS_DIR / filename
    with open(filepath) as f:
        entries = yaml.safe_load(f) or []
    if index < 0 or index >= len(entries):
        return
    if disabled:
        entries[index]["disabled"] = True
    else:
        entries[index].pop("disabled", None)
    with open(filepath, "w") as f:
        yaml.dump(entries, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    cards = _read_all_cards_yaml()
    for sid in editor_sids:
        socketio.emit("all_cards", {
            "cards": cards,
            "locks": _get_locks_for_client(sid),
        }, room=sid)


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

    _reassign_all_ids_globally()   # close the ID gap in this file + shift subsequent files
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

    _reassign_all_ids_globally()   # restored card + subsequent files get correct IDs
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


@socketio.on("delete_all_graveyard")
def on_delete_all_graveyard():
    if request.sid not in editor_sids:
        return
    _write_graveyard([])
    emit("graveyard_data", {"cards": []})


@socketio.on("get_card_trees")
def on_get_card_trees():
    if not _ensure_editor(request.sid):
        return
    result = _build_card_trees()
    result["locks"] = _get_locks_for_client(request.sid)
    emit("card_trees", result)


# ── Parameters editor ────────────────────────────────────────

@socketio.on("get_params")
def on_get_params():
    if not _ensure_editor(request.sid):
        return
    params = dict(load_params() or {})
    params.pop("money_per_users", None)    # legacy key removed
    params.pop("reputation_max", None)     # derived from thresholds
    params.pop("reputation_min", None)     # derived from thresholds
    params.setdefault("reputation_modifier_resource_values", {})
    params.setdefault("reputation_modifier_production_values", {})
    emit("params_data", params)

@socketio.on("save_params")
def on_save_params(data):
    if not _ensure_editor(request.sid):
        return
    data = dict(data or {})
    data.pop("money_per_users", None)  # legacy key removed
    data.pop("reputation_max", None)   # derived from thresholds
    data.pop("reputation_min", None)   # derived from thresholds
    data["reputation_modifier_resource_values"] = dict(data.get("reputation_modifier_resource_values") or {})
    data["reputation_modifier_production_values"] = dict(data.get("reputation_modifier_production_values") or {})
    with open(PARAMS_FILE, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)
    load_params()
    game.total_users = P("total_users", 500)
    # Resize + refill build row if build_row_size changed
    game._refill_build_row()
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