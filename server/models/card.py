from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Card:
    name: str
    cost: int
    tag: str
    card_type: str  # "technology", "action", "resource"
    description: str = ""
    production: dict[str, int] = field(default_factory=dict)
    immediate: dict[str, int] = field(default_factory=dict)
    effect: str | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "cost": self.cost,
            "tag": self.tag,
            "card_type": self.card_type,
            "description": self.description,
            "production": self.production,
            "immediate": self.immediate,
            "effect": self.effect,
        }

    @classmethod
    def from_yaml(cls, data: dict, card_type: str) -> Card:
        return cls(
            name=data["name"],
            cost=data.get("cost", 0),
            tag=data.get("tag", ""),
            card_type=card_type,
            description=data.get("description", ""),
            production=data.get("production") or {},
            immediate=data.get("immediate") or {},
            effect=data.get("effect"),
        )
