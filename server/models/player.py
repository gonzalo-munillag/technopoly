from __future__ import annotations
from dataclasses import dataclass, field

from .card import Card


@dataclass
class Player:
    player_id: str
    name: str
    hand: list[Card] = field(default_factory=list)
    played_cards: list[Card] = field(default_factory=list)
    resources: dict[str, int] = field(default_factory=dict)
    production: dict[str, int] = field(default_factory=dict)

    def __post_init__(self):
        if not self.resources:
            self.resources = {
                "credits": 0,
                "energy": 0,
                "materials": 0,
                "data": 0,
            }
        if not self.production:
            self.production = {
                "credits": 0,
                "energy": 0,
                "materials": 0,
                "data": 0,
            }

    def add_to_hand(self, card: Card):
        self.hand.append(card)

    def play_card(self, card_name: str) -> Card | None:
        for i, card in enumerate(self.hand):
            if card.name == card_name:
                played = self.hand.pop(i)
                self.played_cards.append(played)
                self._apply_card(played)
                return played
        return None

    def _apply_card(self, card: Card):
        for resource, amount in card.immediate.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount
        for resource, amount in card.production.items():
            self.production[resource] = self.production.get(resource, 0) + amount

    def collect_production(self):
        """Add production values to resources (called each generation/round)."""
        for resource, amount in self.production.items():
            self.resources[resource] = self.resources.get(resource, 0) + amount

    def can_afford(self, card: Card) -> bool:
        return self.resources.get("credits", 0) >= card.cost

    def spend(self, amount: int, resource: str = "credits") -> bool:
        if self.resources.get(resource, 0) >= amount:
            self.resources[resource] -= amount
            return True
        return False

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "hand": [c.to_dict() for c in self.hand],
            "played_cards": [c.to_dict() for c in self.played_cards],
            "resources": self.resources,
            "production": self.production,
        }
