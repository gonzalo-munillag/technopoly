from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Card:
    name: str
    cost: int
    tag: str
    card_type: str  # "cyber_attack", "fuck_up", "platform", "leverage", "innovation", "company", "regulation"
    deck: str = ""  # "projects", "boosters", "company", "regulation"
    description: str = ""
    production: dict[str, int] = field(default_factory=dict)
    immediate: dict[str, int] = field(default_factory=dict)
    effect: str | None = None
    starting_resources: dict[str, int] = field(default_factory=dict)
    starting_production: dict[str, int] = field(default_factory=dict)
    # Regulation-specific fields
    targets: str | None = None          # "all" or a card_type like "platform"
    penalty: dict[str, int] = field(default_factory=dict)
    court_penalty: dict[str, int] = field(default_factory=dict)
    court_threshold: int = 4            # roll >= this to win in court

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "cost": self.cost,
            "tag": self.tag,
            "card_type": self.card_type,
            "deck": self.deck,
            "description": self.description,
            "production": self.production,
            "immediate": self.immediate,
            "effect": self.effect,
            "starting_resources": self.starting_resources,
            "starting_production": self.starting_production,
            "targets": self.targets,
            "penalty": self.penalty,
            "court_penalty": self.court_penalty,
            "court_threshold": self.court_threshold,
        }

    @classmethod
    def from_yaml(cls, data: dict, card_type: str, deck: str) -> Card:
        return cls(
            name=data["name"],
            cost=data.get("cost", 0),
            tag=data.get("tag", ""),
            card_type=card_type,
            deck=deck,
            description=data.get("description", ""),
            production=data.get("production") or {},
            immediate=data.get("immediate") or {},
            effect=data.get("effect"),
            starting_resources=data.get("starting_resources") or {},
            starting_production=data.get("starting_production") or {},
            targets=data.get("targets"),
            penalty=data.get("penalty") or {},
            court_penalty=data.get("court_penalty") or {},
            court_threshold=data.get("court_threshold", 4),
        )
