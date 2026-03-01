from __future__ import annotations
from dataclasses import dataclass, field

from .card import Card

RESOURCE_KEYS = ["users", "money", "engineers", "suits", "servers", "ads", "reputation"]
PRODUCTION_KEYS = ["hr"]


@dataclass
class Player:
    player_id: str
    name: str
    hand: list[Card] = field(default_factory=list)
    played_cards: list[Card] = field(default_factory=list)
    resources: dict[str, int] = field(default_factory=dict)
    production: dict[str, int] = field(default_factory=dict)
    company: Card | None = None
    cards_played_this_turn: int = 0
    ready: bool = False
    draft_pool: list[Card] = field(default_factory=list)
    regulation_resolved: bool = False
    year_done: bool = False

    def __post_init__(self):
        if not self.resources:
            self.resources = {k: 0 for k in RESOURCE_KEYS}
        if not self.production:
            self.production = {k: 0 for k in PRODUCTION_KEYS}

    def set_company(self, card: Card):
        self.company = card
        for resource, amount in card.starting_resources.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount
        for resource, amount in card.starting_production.items():
            self.production[resource] = self.production.get(resource, 0) + amount

    def add_to_hand(self, card: Card):
        self.hand.append(card)

    def play_card(self, card_name: str) -> Card | None:
        for i, card in enumerate(self.hand):
            if card.name == card_name:
                played = self.hand.pop(i)
                self.played_cards.append(played)
                self.apply_card_effects(played)
                self.cards_played_this_turn += 1
                return played
        return None

    def remove_from_hand(self, card_name: str) -> Card | None:
        """Remove a card from hand without adding to played_cards."""
        for i, card in enumerate(self.hand):
            if card.name == card_name:
                return self.hand.pop(i)
        return None

    def apply_card_effects(self, card: Card):
        for resource, amount in card.immediate.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount
        for resource, amount in card.production.items():
            self.production[resource] = self.production.get(resource, 0) + amount

    def collect_production(self):
        """Add production values to resources (called each year)."""
        for resource, amount in self.production.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount

    def can_afford(self, card: Card) -> bool:
        return self.resources.get("money", 0) >= card.cost

    def spend(self, amount: int, resource: str = "money") -> bool:
        if self.resources.get(resource, 0) >= amount:
            self.resources[resource] -= amount
            return True
        return False

    def apply_penalty(self, penalty: dict[str, int]):
        for resource, amount in penalty.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount

    def has_pending_fuckups(self) -> bool:
        return any(c.card_type == "fuck_up" for c in self.hand)

    def get_fuckup_cards(self) -> list[Card]:
        return [c for c in self.hand if c.card_type == "fuck_up"]

    def is_affected_by_regulation(self, regulation: Card) -> bool:
        return regulation is not None

    def reset_turn(self):
        self.cards_played_this_turn = 0

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "hand": [c.to_dict() for c in self.hand],
            "played_cards": [c.to_dict() for c in self.played_cards],
            "resources": self.resources,
            "production": self.production,
            "company": self.company.to_dict() if self.company else None,
            "cards_played_this_turn": self.cards_played_this_turn,
            "ready": self.ready,
            "draft_pool": [c.to_dict() for c in self.draft_pool],
            "regulation_resolved": self.regulation_resolved,
            "has_fuckups": self.has_pending_fuckups(),
            "year_done": self.year_done,
        }
