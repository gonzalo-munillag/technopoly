from __future__ import annotations
from dataclasses import dataclass, field

OPTIONAL_COST_PAIRS = []


@dataclass
class Card:
    name: str
    cost: int
    tag: str
    card_type: str  # "cyber_attack", "fuck_up", "platform", "leverage", "innovation", "company", "regulation"
    id: int = 0
    deck: str = ""  # "projects", "boosters", "company", "regulation"
    description: str = ""
    production: dict[str, int] = field(default_factory=dict)
    immediate: dict[str, int] = field(default_factory=dict)
    effect: str | dict | None = None
    starting_resources: dict[str, int] = field(default_factory=dict)
    starting_production: dict[str, int] = field(default_factory=dict)
    # Regulation-specific fields
    targets_all: int = 1                # 1 = affects all players, 0 = targeted
    target_id: int | list | None = None # specific card ID(s) that are targeted
    target_type: str | None = None      # card type(s) targeted (e.g. "search service")
    compliance: dict[str, int] = field(default_factory=dict)
    court_penalty: dict[str, int] = field(default_factory=dict)
    court_threshold: int = 4            # roll >= this to win in court
    # Card connections: list of {"target_id": int|list, "bonus": {resource: amount}}
    boosts: list[dict] = field(default_factory=list)
    tile_type: str | None = None        # legacy, use build instead
    build: str | None = None            # "data_center", "store", "ad_campaign", "power_plant", "lobby_group", "factory"
    # New platform card fields
    costs: dict = field(default_factory=dict)
    card_color_type: str = ""           # "social platform", "hardware manufacturer", etc.
    number: int = 1                     # copies of this card in the deck
    image: str = ""
    payee_card_id: int | None = None
    starting_tiles: list[str] = field(default_factory=list)
    factory_refund: int = 0          # $ refund per adjacent factory when this power plant is placed
    dc_production_bonus: int = 0     # +N data_centers production per adjacent data center

    @property
    def fee(self) -> int:
        return self.costs.get("fee", 0) or 0

    @property
    def fee_card_id(self) -> int | None:
        return self.costs.get("fee_card_id")

    def to_dict(self) -> dict:
        d = {
            "name": self.name,
            "id": self.id,
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
            "targets_all": self.targets_all,
            "target_id": self.target_id,
            "target_type": self.target_type,
            "compliance": self.compliance,
            "court_penalty": self.court_penalty,
            "court_threshold": self.court_threshold,
            "boosts": self.boosts,
            "tile_type": self.tile_type,
            "build": self.build,
            "costs": self.costs,
            "card_color_type": self.card_color_type,
            "number": self.number,
            "image": self.image,
            "payee_card_id": self.payee_card_id,
            "starting_tiles": self.starting_tiles,
            "factory_refund": self.factory_refund,
            "dc_production_bonus": self.dc_production_bonus,
        }
        return d

    @classmethod
    def from_yaml(cls, data: dict, card_type: str, deck: str) -> Card:
        costs_raw = data.get("costs") or {}
        effect_raw = data.get("effect")
        # Support effect as dict (new platform format) or string (legacy)
        eff_dict = effect_raw if isinstance(effect_raw, dict) else None
        eff_str = effect_raw if isinstance(effect_raw, str) else None

        return cls(
            name=data["name"],
            id=data.get("id", 0),
            cost=data.get("cost", 0),
            tag=data.get("tag", "") or data.get("type", ""),
            card_type=card_type,
            deck=deck,
            description=data.get("description", ""),
            production=data.get("production") or {},
            immediate=data.get("immediate") or {},
            effect=eff_dict or eff_str,
            starting_resources=data.get("starting_resources") or {},
            starting_production=data.get("starting_production") or {},
            targets_all=data.get("targets_all", 1),
            target_id=data.get("target_id"),
            target_type=data.get("target_type"),
            compliance=data.get("compliance") or data.get("penalty") or {},
            court_penalty=data.get("court_penalty") or {},
            court_threshold=data.get("court_threshold", 4),
            boosts=data.get("boosts") or [],
            tile_type=data.get("tile_type") or data.get("build"),
            build=data.get("build"),
            costs=costs_raw,
            card_color_type=data.get("type", ""),
            number=data.get("number", 1),
            image=data.get("image", ""),
            payee_card_id=data.get("payee_card_id"),
            starting_tiles=data.get("starting_tiles") or [],
            factory_refund=data.get("factory_refund", 0),
            dc_production_bonus=data.get("dc_production_bonus", 0),
        )
