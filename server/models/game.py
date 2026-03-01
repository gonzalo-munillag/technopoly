from __future__ import annotations
import random
from pathlib import Path
from dataclasses import dataclass, field

import yaml

from .card import Card
from .player import Player

CARDS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cards"

CARD_TYPE_MAP = {
    "technology_cards.yaml": "technology",
    "action_cards.yaml": "action",
    "resource_cards.yaml": "resource",
}


@dataclass
class Game:
    players: dict[str, Player] = field(default_factory=dict)
    deck: list[Card] = field(default_factory=list)
    discard_pile: list[Card] = field(default_factory=list)
    turn_order: list[str] = field(default_factory=list)
    current_turn_index: int = 0
    generation: int = 1
    started: bool = False
    game_master_id: str | None = None

    # ── deck management ──────────────────────────────────────

    def load_deck(self, cards_dir: Path = CARDS_DIR):
        """Load all card YAML files and build a shuffled deck."""
        self.deck = []
        for filename, card_type in CARD_TYPE_MAP.items():
            filepath = cards_dir / filename
            if not filepath.exists():
                continue
            with open(filepath) as f:
                entries = yaml.safe_load(f) or []
            for entry in entries:
                self.deck.append(Card.from_yaml(entry, card_type))
        random.shuffle(self.deck)

    def draw_card(self) -> Card | None:
        if not self.deck:
            return None
        return self.deck.pop()

    def draw_cards(self, n: int) -> list[Card]:
        drawn = []
        for _ in range(n):
            card = self.draw_card()
            if card is None:
                break
            drawn.append(card)
        return drawn

    # ── player management ────────────────────────────────────

    def add_player(self, player_id: str, name: str) -> Player:
        player = Player(player_id=player_id, name=name)
        self.players[player_id] = player
        return player

    def remove_player(self, player_id: str):
        self.players.pop(player_id, None)
        if player_id in self.turn_order:
            self.turn_order.remove(player_id)

    # ── game flow ────────────────────────────────────────────

    def start(self, cards_per_player: int = 4):
        """Start the game: load deck, deal cards, randomise turn order."""
        self.load_deck()
        self.turn_order = list(self.players.keys())
        random.shuffle(self.turn_order)
        self.current_turn_index = 0
        self.generation = 1
        self.started = True

        for player in self.players.values():
            cards = self.draw_cards(cards_per_player)
            for card in cards:
                player.add_to_hand(card)
            player.resources["credits"] = 10

    @property
    def current_player_id(self) -> str | None:
        if not self.turn_order:
            return None
        return self.turn_order[self.current_turn_index % len(self.turn_order)]

    def next_turn(self) -> str | None:
        """Advance to the next player. Returns the new current player id."""
        if not self.turn_order:
            return None
        self.current_turn_index += 1
        if self.current_turn_index >= len(self.turn_order):
            self.current_turn_index = 0
            self._new_generation()
        return self.current_player_id

    def _new_generation(self):
        """Start a new generation: all players collect production."""
        self.generation += 1
        for player in self.players.values():
            player.collect_production()

    # ── serialisation ────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "started": self.started,
            "generation": self.generation,
            "deck_remaining": len(self.deck),
            "current_player_id": self.current_player_id,
            "turn_order": self.turn_order,
            "players": {pid: p.to_dict() for pid, p in self.players.items()},
        }
