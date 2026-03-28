from __future__ import annotations
import random
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum

import yaml

from .card import Card
from .player import Player
from .board import Board

CARDS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cards"

PROJECTS_FILES = {
    "cyber_attacks.yaml": "cyber_attack",
    "fuck_ups.yaml": "fuck_up",
    "platform.yaml": "platform",
    "build.yaml": "build",
}

BOOSTERS_FILES = {
    "leverage.yaml": "leverage",
    "innovation.yaml": "innovation",
}

COMPANY_FILE = "company.yaml"
EVENTS_FILES = {
    "regulation.yaml": "regulation",
    "world_event.yaml": "world_event",
}

PARAMS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "params.yaml"

_params_cache: dict = {}

def load_params() -> dict:
    global _params_cache
    if PARAMS_FILE.exists():
        with open(PARAMS_FILE) as f:
            _params_cache = yaml.safe_load(f) or {}
    return _params_cache

def P(key: str, default=None):
    """Get a game parameter (reads from cache)."""
    if not _params_cache:
        load_params()
    return _params_cache.get(key, default)


class Phase(str, Enum):
    COMPANY_PICK = "company_pick"
    YEAR_START_DRAFT = "year_start_draft"
    HIRING = "hiring"
    REGULATION = "regulation"
    PLAYER_TURNS = "player_turns"
    YEAR_END = "year_end"


@dataclass
class Game:
    players: dict[str, Player] = field(default_factory=dict)
    projects_deck: list[Card] = field(default_factory=list)
    boosters_deck: list[Card] = field(default_factory=list)
    regulation_deck: list[Card] = field(default_factory=list)
    company_cards: list[Card] = field(default_factory=list)
    discard_pile: list[Card] = field(default_factory=list)
    turn_order: list[str] = field(default_factory=list)
    current_turn_index: int = 0
    year: int = 1
    phase: Phase = Phase.COMPANY_PICK
    current_regulation: Card | None = None
    started: bool = False
    game_master_id: str | None = None
    dealer_index: int = 0
    draft_discard: list[Card] = field(default_factory=list)
    company_offers: dict[str, list[Card]] = field(default_factory=dict)
    drafted_fuckups: dict[str, list[Card]] = field(default_factory=dict)
    board: Board = field(default_factory=Board)
    total_users: int = 0
    user_pool: int = 0

    def take_users(self, amount: int) -> int:
        """Decrement the display pool and return amount (uncapped).
        The pool tracks uncaptured market share for the pie chart only."""
        if amount <= 0:
            return 0
        self.user_pool = max(0, self.user_pool - amount)
        return amount

    # ── deck loading ─────────────────────────────────────────

    def _load_deck(self, file_map: dict[str, str], deck_name: str,
                   cards_dir: Path = CARDS_DIR) -> list[Card]:
        cards: list[Card] = []
        for filename, card_type in file_map.items():
            filepath = cards_dir / filename
            if not filepath.exists():
                continue
            with open(filepath) as f:
                entries = yaml.safe_load(f) or []
            for entry in entries:
                if entry.get("disabled"):   # skip deactivated cards
                    continue
                count = entry.get("number", 1) or 1
                for _ in range(count):
                    cards.append(Card.from_yaml(entry, card_type, deck_name))
        random.shuffle(cards)
        return cards

    def load_all_decks(self, cards_dir: Path = CARDS_DIR):
        self.projects_deck = self._load_deck(PROJECTS_FILES, "projects", cards_dir)
        self.boosters_deck = self._load_deck(BOOSTERS_FILES, "boosters", cards_dir)
        self.regulation_deck = self._load_deck(
            EVENTS_FILES, "regulation", cards_dir
        )
        filepath = cards_dir / COMPANY_FILE
        self.company_cards = []
        if filepath.exists():
            with open(filepath) as f:
                entries = yaml.safe_load(f) or []
            for entry in entries:
                if entry.get("disabled"):   # skip deactivated company cards
                    continue
                self.company_cards.append(
                    Card.from_yaml(entry, "company", "company")
                )

    def _refill_deck(self, deck: list[Card], deck_name: str):
        """Move cards of this deck type from discard pile back to the deck."""
        returned = [c for c in self.discard_pile if c.deck == deck_name]
        self.discard_pile = [c for c in self.discard_pile if c.deck != deck_name]
        deck.extend(returned)
        random.shuffle(deck)

    def draw_from(self, deck: list[Card], n: int,
                  deck_name: str = "") -> list[Card]:
        drawn = []
        for _ in range(n):
            if not deck and deck_name:
                self._refill_deck(deck, deck_name)
            if not deck:
                break
            drawn.append(deck.pop())
        return drawn

    # ── player management ────────────────────────────────────

    _PLAYER_COLORS = ["#f9c912", "#00cfff", "#4dff91", "#ff5ef3", "#ff4422", "#ff9900", "#b966ff", "#00e5c3"]

    def add_player(self, player_id: str, name: str) -> Player:
        idx = len(self.players) % len(self._PLAYER_COLORS)
        player = Player(player_id=player_id, name=name, color=self._PLAYER_COLORS[idx])
        self.players[player_id] = player
        return player

    def remove_player(self, player_id: str):
        self.players.pop(player_id, None)
        if player_id in self.turn_order:
            self.turn_order.remove(player_id)

    # ── game flow ────────────────────────────────────────────

    def start(self):
        load_params()
        self.total_users = P("total_users", 500)
        self.user_pool = self.total_users
        self.load_all_decks()
        self.turn_order = list(self.players.keys())
        random.shuffle(self.turn_order)
        self.dealer_index = random.randint(0, len(self.turn_order) - 1)
        self.current_turn_index = self.dealer_index
        self.year = 1
        self.started = True
        self.phase = Phase.COMPANY_PICK
        self._deal_company_offers()

    def _deal_company_offers(self):
        """Give each player unique company cards based on params."""
        random.shuffle(self.company_cards)
        self.company_offers = {}
        for pid in self.turn_order:
            n = P("company_offers", 2)
            offers = self.company_cards[:n]
            self.company_cards = self.company_cards[n:]
            self.company_offers[pid] = offers

    def pick_company(self, player_id: str, card_name: str) -> Card | None:
        player = self.players.get(player_id)
        if not player or player.company is not None:
            return None
        offers = self.company_offers.get(player_id, [])
        for i, card in enumerate(offers):
            if card.name == card_name:
                chosen = offers.pop(i)
                player.set_company(chosen, self)
                player.ready = True
                return chosen
        return None

    def all_players_ready(self) -> bool:
        return all(p.ready for p in self.players.values())

    def clear_ready(self):
        for p in self.players.values():
            p.ready = False

    # ── year start: draft phase (simultaneous) ─────────────────

    def begin_year_draft(self):
        self.phase = Phase.YEAR_START_DRAFT
        self.clear_ready()
        self.draft_discard = []
        self.drafted_fuckups = {}
        for player in self.players.values():
            player.draft_pool = []
            player.year_done = False
            player.regulation_resolved = False
            player.went_to_court = False
            player.court_start_ready = False
            drawn = self._draw_projects_limited(P("projects_draw", 3))
            fuckups = []
            for card in drawn:
                if card.card_type == "fuck_up":
                    player.add_to_hand(card)
                    fuckups.append(card)
                else:
                    player.draft_pool.append(card)
            self.drafted_fuckups[player.player_id] = fuckups
            boosters = self.draw_from(
                self.boosters_deck, P("boosters_draw", 3), "boosters"
            )
            player.draft_pool.extend(boosters)

    def _draw_projects_limited(self, n: int) -> list[Card]:
        """Draw n cards from the projects deck. At most 1 fuck-up allowed;
        if a 2nd is drawn it is silently discarded and replaced.
        A fuck-up DOES consume one of the n slots."""
        drawn: list[Card] = []
        fuckup_count = 0
        safety = 50
        while len(drawn) < n and safety > 0:
            safety -= 1
            if not self.projects_deck:
                self._refill_deck(self.projects_deck, "projects")
                if not self.projects_deck:
                    break
            card = self.projects_deck.pop()
            if card.card_type == "fuck_up" and fuckup_count >= 1:
                self.discard_pile.append(card)
                continue
            if card.card_type == "fuck_up":
                fuckup_count += 1
            drawn.append(card)
        return drawn

    def keep_drafted_card(self, player_id: str, card_name: str) -> bool:
        player = self.players.get(player_id)
        if not player:
            return False
        for i, card in enumerate(player.draft_pool):
            if card.name == card_name:
                if card.card_type == "fuck_up":
                    return False
                if not player.spend(P("draft_cost", 3), "money"):
                    return False
                kept = player.draft_pool.pop(i)
                player.add_to_hand(kept)
                return True
        return False

    def finish_draft(self, player_id: str):
        """Discard remaining draft cards and mark player as ready."""
        player = self.players.get(player_id)
        if not player:
            return
        self.draft_discard.extend(player.draft_pool)
        player.draft_pool = []
        player.ready = True

    def all_drafts_done(self) -> bool:
        return all(p.ready for p in self.players.values())

    def finalize_draft(self):
        """Return discarded draft cards to their respective decks."""
        for card in self.draft_discard:
            if card.deck == "projects":
                self.projects_deck.append(card)
            elif card.deck == "boosters":
                self.boosters_deck.append(card)
            else:
                self.discard_pile.append(card)
        self.draft_discard = []
        random.shuffle(self.projects_deck)
        random.shuffle(self.boosters_deck)

    # ── regulation phase ─────────────────────────────────────

    def draw_regulation(self):
        self.phase = Phase.REGULATION
        cards = self.draw_from(self.regulation_deck, 1)
        self.current_regulation = cards[0] if cards else None
        for player in self.players.values():
            player.regulation_resolved = False

    def any_player_affected(self) -> bool:
        if not self.current_regulation:
            return False
        return any(p.is_affected_by_regulation(self.current_regulation)
                   for p in self.players.values())

    def is_player_affected(self, player_id: str) -> bool:
        player = self.players.get(player_id)
        if not player or not self.current_regulation:
            return False
        return player.is_affected_by_regulation(self.current_regulation)

    def resolve_regulation_accept(self, player_id: str) -> dict:
        player = self.players.get(player_id)
        if not player or not self.current_regulation:
            return {}
        reg = self.current_regulation
        lost_cards = []
        if not reg.targets_all:
            targeted = player.find_targeted_cards(reg)
            for c in targeted:
                if c in player.played_cards:
                    player.played_cards.remove(c)
                    self.discard_pile.append(c)
                    lost_cards.append(c.name)
        penalty = reg.compliance
        player.apply_penalty(penalty, self)
        player.regulation_resolved = True
        player.went_to_court = False
        player.court_start_ready = False
        return {"penalty": penalty, "lost_cards": lost_cards}

    def resolve_regulation_court(self, player_id: str) -> dict:
        player = self.players.get(player_id)
        if not player or not self.current_regulation:
            return {}
        reg = self.current_regulation
        roll = random.randint(1, 6)
        threshold = reg.court_threshold
        won = roll >= threshold
        lost_cards = []
        if won:
            penalty = {}
        else:
            penalty = reg.court_penalty
            player.apply_penalty(penalty, self)
            if not reg.targets_all:
                targeted = player.find_targeted_cards(reg)
                for c in targeted:
                    if c in player.played_cards:
                        player.played_cards.remove(c)
                        self.discard_pile.append(c)
                        lost_cards.append(c.name)
        player.regulation_resolved = True
        player.went_to_court = True
        player.court_start_ready = False
        return {"roll": roll, "threshold": threshold, "won": won, "penalty": penalty, "lost_cards": lost_cards}

    def all_regulation_resolved(self) -> bool:
        """Every player must acknowledge/resolve the regulation."""
        return all(p.regulation_resolved for p in self.players.values())

    def court_players(self) -> list:
        return [p for p in self.players.values() if p.went_to_court]

    def all_court_players_ready(self) -> bool:
        """True when every player who went to court has clicked Start Year.
        If nobody went to court, returns True immediately (auto-advance)."""
        court = self.court_players()
        if not court:
            return True
        return all(p.court_start_ready for p in court)

    def advance_past_regulation(self):
        """After regulation resolved, begin draft for this year."""
        self.begin_year_draft()

    # ── player turns phase ───────────────────────────────────

    @property
    def current_player_id(self) -> str | None:
        if not self.turn_order:
            return None
        return self.turn_order[self.current_turn_index % len(self.turn_order)]

    def next_turn(self) -> str | None:
        """Advance to next active player. Skips year_done and empty-hand
        players (marks them year_done). Returns None when all are done."""
        if not self.turn_order:
            return None
        current = self.players.get(self.current_player_id)
        if current:
            current.reset_turn()

        n = len(self.turn_order)
        for _ in range(n):
            self.current_turn_index = (self.current_turn_index + 1) % n
            pid = self.turn_order[self.current_turn_index]
            player = self.players.get(pid)
            if not player:
                continue
            if player.year_done:
                continue
            if len(player.hand) == 0:
                player.year_done = True
                continue
            return pid
        return None

    def all_year_done(self) -> bool:
        return all(p.year_done for p in self.players.values())

    def end_current_year(self) -> list:
        """End this year: collect production, start next year.
        Returns list of (player_id, player_name) for any player that went bankrupt."""
        bankrupt = []
        for pid, player in list(self.players.items()):
            went_bankrupt = player.collect_production(
                P("money_per_users", 20),
                P("data_per_users", 200),
            )
            player.reset_turn()
            player.year_done = False
            if went_bankrupt:
                bankrupt.append((pid, player.name))
        for pid, _ in bankrupt:
            self.players.pop(pid, None)
            if pid in self.turn_order:
                self.turn_order.remove(pid)
        self.year += 1
        self._rotate_dealer()
        if self.year >= 2:
            self.draw_regulation()
        else:
            self.begin_year_draft()
        return bankrupt

    def _rotate_dealer(self):
        if self.turn_order:
            self.dealer_index = (self.dealer_index + 1) % len(self.turn_order)

    # ── end game ─────────────────────────────────────────────

    def restart(self):
        """Reset game state but keep players."""
        self.projects_deck.clear()
        self.boosters_deck.clear()
        self.regulation_deck.clear()
        self.company_cards.clear()
        self.discard_pile.clear()
        self.draft_discard.clear()
        self.company_offers.clear()
        self.drafted_fuckups.clear()
        self.turn_order.clear()
        self.current_turn_index = 0
        self.year = 1
        self.current_regulation = None
        self.dealer_index = 0
        for player in self.players.values():
            player.hand.clear()
            player.played_cards.clear()
            player.draft_pool.clear()
            player.company = None
            player.cards_played_this_turn = 0
            player.ready = False
            player.regulation_resolved = False
            player.year_done = False
            player.pending_tile = None
            player.resources = {k: 0 for k in player.resources}
            player.production = {k: 0 for k in player.production}
            player.users = 0
        self.board.reset()
        self.start()

    def end_game(self):
        self.players.clear()
        self.projects_deck.clear()
        self.boosters_deck.clear()
        self.regulation_deck.clear()
        self.company_cards.clear()
        self.discard_pile.clear()
        self.draft_discard.clear()
        self.company_offers.clear()
        self.drafted_fuckups.clear()
        self.turn_order.clear()
        self.current_turn_index = 0
        self.year = 1
        self.phase = Phase.COMPANY_PICK
        self.current_regulation = None
        self.started = False
        self.game_master_id = None
        self.dealer_index = 0
        self.board.reset()

    # ── serialisation ────────────────────────────────────────

    def _card_name_map(self) -> dict[int, str]:
        """Build a map of card_id -> card_name from all known cards."""
        m: dict[int, str] = {}
        for deck in (self.projects_deck, self.boosters_deck,
                     self.regulation_deck, self.company_cards,
                     self.discard_pile, self.draft_discard):
            for c in deck:
                if c.id:
                    m[c.id] = c.name
        for p in self.players.values():
            for c in p.hand + p.played_cards + p.draft_pool:
                if c.id:
                    m[c.id] = c.name
            if p.company and p.company.id:
                m[p.company.id] = p.company.name
        return m

    def to_dict(self) -> dict:
        return {
            "started": self.started,
            "year": self.year,
            "phase": self.phase.value,
            "projects_remaining": len(self.projects_deck),
            "boosters_remaining": len(self.boosters_deck),
            "current_player_id": self.current_player_id,
            "turn_order": self.turn_order,
            "start_player_id": self.turn_order[self.dealer_index] if self.turn_order else None,
            "any_affected_by_regulation": self.any_player_affected() if self.current_regulation else False,
            "current_regulation": self.current_regulation.to_dict() if self.current_regulation else None,
            "players": {pid: p.to_dict() for pid, p in self.players.items()},
            "board": self.board.to_list(),
            "card_names": self._card_name_map(),
            "total_users": self.total_users,
            "user_pool": self.user_pool,
            "params": _params_cache,
        }
