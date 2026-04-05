from __future__ import annotations
from dataclasses import dataclass, field
import uuid

OPTIONAL_COST_PAIRS = []


def _intify(d):
    """Coerce all numeric values in a dict to int (rounds floats)."""
    if not isinstance(d, dict):
        return d
    return {k: int(round(v)) if isinstance(v, (int, float)) else v for k, v in d.items()}


def _intify_conversion(conv):
    """Sanitize a resource_conversion dict: intify cost and gain sub-dicts."""
    if not isinstance(conv, dict):
        return None
    out = dict(conv)
    for sub in ("cost", "gain"):
        if isinstance(out.get(sub), dict):
            out[sub] = _intify(out[sub])
    return out


def _intify_bonus_list(lst):
    """Sanitize a list of bonus/adjacency entries: intify their resource sub-dicts."""
    if not isinstance(lst, list):
        return lst
    out = []
    for entry in lst:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        e = dict(entry)
        for sub in ("bonus", "production", "immediate", "extra_cost", "extra_effect", "cost"):
            if isinstance(e.get(sub), dict):
                e[sub] = _intify(e[sub])
        out.append(e)
    return out


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
    # World-event: extra effects applied only when a player meets the card's
    # play_thresholds / requirements / required_card_ids conditions.
    conditional_effects: dict[str, int] = field(default_factory=dict)
    # Card connections: list of {"target_id": int|list, "bonus": {resource: amount}}
    boosts: list[dict] = field(default_factory=list)
    tile_type: str | None = None        # legacy, use build instead
    build: str | list[str] | None = None  # single build type or list of build types
    # New platform card fields
    costs: dict = field(default_factory=dict)
    card_color_type: str = ""           # primary subtype, e.g. "social platform"
    secondary_card_color_type: str | None = None  # optional secondary subtype (e.g. innovation card also counts as platform subtype)
    number: int = 1                     # copies of this card in the deck
    image: str = ""
    payee_card_id: int | None = None
    starting_tiles: list[str] = field(default_factory=list)
    # Bonus entries carried by the placed tile itself.
    # Format: [{"build_type": "<tile_type>|None", "immediate": {...}, "production": {...}}, ...]
    placed_tile_adjacency_bonuses: list[dict] = field(default_factory=list)
    # Card-color/card-type requirements the player must have already played.
    # Backward-compatible formats:
    #   ["hardware manufacturer", "innovation"]
    #   [{"type": "hardware manufacturer", "count": 2}, ...]
    requirements: list = field(default_factory=list)
    required_card_ids: list[int] = field(default_factory=list)  # specific card IDs the player must have played
    # Generic resource/production thresholds needed to play (or trigger a fuck-up).
    # Format: [{"key": "users", "min": 20}, {"key": "money", "min": 5, "kind": "production"}]
    # "kind" defaults to "resource" when omitted.
    play_thresholds: list[dict] = field(default_factory=list)
    court_threshold_modifier: int | None = None  # reduces the die-roll threshold needed to win in court (e.g. -1 → need ≥3 instead of ≥4)
    # Optional tile-adjacency restriction for build cards:
    # card can place its tile only if at least one adjacent placed tile type matches.
    only_playable_next_to: list[str] = field(default_factory=list)
    # Optional terrain restriction for build cards:
    # card tile can only be placed on these terrain types.
    only_playable_on_terrains: list[str] = field(default_factory=list)
    # Card-level placement bonus: when this card's tile is placed next to matching
    # building types, grant immediate/production bonuses.
    # Format: [{"build_type": "<tile_type>|None", "immediate": {...}, "production": {...}}, ...]
    bonuses_by_placing_next_to_building: list[dict] = field(default_factory=list)
    # Card-level placement bonus: when this card's tile is built on matching terrain
    # types, grant immediate/production bonuses.
    # Format: [{"terrain_type": "<terrain>|None", "immediate": {...}, "production": {...}}, ...]
    bonuses_by_building_on_terrain_type: list[dict] = field(default_factory=list)
    # Card-level placement bonus: when this card's tile is built adjacent to matching
    # terrain types, grant immediate/production bonuses.
    # Format: [{"terrain_type": "<terrain>|None", "immediate": {...}, "production": {...}}, ...]
    bonuses_by_building_adjacent_to_terrain_type: list[dict] = field(default_factory=list)
    # Optional placement fee rule:
    # when placing this card's tile adjacent to one of these build types owned by
    # another player, pay adjacent_placement_fee to one eligible adjacent owner.
    adjacent_placement_fee: int = 0
    adjacent_placement_fee_target_types: list[str] = field(default_factory=list)
    # Optional responsible-mining upgrade: {extra_cost: {resource: amount}, extra_effect: {resource: amount}}
    responsible_mining: dict = field(default_factory=dict)
    # Enhancement tiers: [{users, data_cost}, ...] — tier 1 is base, upgrade by spending data
    tiers: list[dict] = field(default_factory=list)
    # Which tier the card is currently at (0 = no tiers; 1 = base tier; 2/3 = upgraded)
    current_tier: int = 0
    # Craftable items: things a player can produce from this played card.
    # Each entry: {name, build, cost: {res: amount}, fee: int, fee_card_type: str,
    #              requires_placed_build: str|None, only_playable_next_to: [], only_playable_on_terrains: []}
    producibles: list[dict] = field(default_factory=list)
    # Pollution classification: "neutral" (default), "polluting", or "green"
    pollution_tag: str = "neutral"
    # Optional extra cost a player can pay when playing to upgrade from polluting → green
    fee_for_green: dict | None = None
    # Fuck-up: force the player to lose a played card.
    # Format: {"mode": "least_users"|"player_choice", "target_types": ["social platform", ...]}
    lose_card_rule: dict | None = None
    # Leverage: steal a card of this type from an opponent's hand (e.g. "innovation", "platform").
    steal_card: str | None = None
    # Fuck-up: next player can poach employees from this player.
    # Format: {"max": int, "price": int}  (max employees total, price per employee)
    poach_employees: dict | None = None
    # Leverage: targeted leverage action against opponents meeting a vulnerability condition.
    # Format: {
    #   "vulnerability_type": str|None,      # opponent must NOT have played this card type
    #   "vulnerability_card_id": int|None,    # opponent must NOT have played this card id
    #   "no_condition": bool,                 # if true, all opponents are targets
    #   "target_card_type": str|None,         # eligible cards must be this type
    #   "target_card_id": int|None,           # eligible cards must have this id
    #   "target_fee_card_id": int|None,       # eligible cards must pay a fee to this card id
    #   "actions": [
    #     {"type": "steal_money", "amount": int},
    #     {"type": "steal_cards", "count": int, "chooser": "attacker"|"victim"},
    #     {"type": "deactivate_cards", "count": int, "chooser": "attacker"|"victim"},
    #     {"type": "delete_cards", "count": int, "chooser": "attacker"|"victim"},
    #     {"type": "fee_per_type", "card_type": str, "amount": int},
    #     {"type": "steal_users", "amount": int},
    #     {"type": "steal_data", "amount": int},
    #   ]
    # }
    targeted_leverage: dict | None = None
    # Resource conversion: click a button on the played card to convert resources, once per year.
    # Format: {"name": str, "cost": {res: amount}, "gain": {res: amount}}
    resource_conversion: dict | None = None
    # Stable per-instance identifier — never shared between copies of the same card.
    # Uses uuid4 so it survives across moves (hand → played_cards) and is never reused
    # unlike id(card) whose memory address can be recycled after garbage collection.
    _instance_id: str = field(default_factory=lambda: str(uuid.uuid4()), repr=False, compare=False, hash=False)
    # Runtime override: set to "green" when the player pays fee_for_green at play time
    _effective_pollution_tag: str | None = field(default=None, repr=False, compare=False, hash=False)
    # Tracks which producible indices have been used this year (reset at year start)
    _producibles_used: set[int] = field(default_factory=set, repr=False, compare=False, hash=False)
    _conversion_used_this_year: bool = field(default=False, repr=False, compare=False, hash=False)
    _tier_upgraded_this_year: bool = field(default=False, repr=False, compare=False, hash=False)
    _dodged: bool = field(default=False, repr=False, compare=False, hash=False)
    # When set, the card is deactivated by a leverage action.
    # Format: {"reactivate_type": str|None, "reactivate_card_id": int|None, "reactivate_card_name": str|None}
    _deactivated_info: dict | None = field(default=None, repr=False, compare=False, hash=False)

    @property
    def effective_pollution_tag(self) -> str:
        return self._effective_pollution_tag or self.pollution_tag

    @property
    def fee(self) -> int:
        return self.costs.get("fee", 0) or 0

    @property
    def fee_card_id(self) -> int | None:
        return self.costs.get("fee_card_id")

    @property
    def fee_card_type(self) -> str | None:
        """Fee is paid to a player who has played a card of this type."""
        return self.costs.get("fee_card_type") or None

    @property
    def fee_company_type(self) -> str | None:
        """Fee is paid to a player whose chosen company is of this type."""
        return self.costs.get("fee_company_type") or None

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
            "conditional_effects": self.conditional_effects or {},
            "boosts": self.boosts,
            "tile_type": self.tile_type,
            "build": self.build,
            "costs": self.costs,
            "card_color_type": self.card_color_type,
            "secondary_card_color_type": self.secondary_card_color_type,
            "secondary_type": self.secondary_card_color_type,
            "number": self.number,
            "image": self.image,
            "payee_card_id": self.payee_card_id,
            "starting_tiles": self.starting_tiles,
            "placed_tile_adjacency_bonuses": self.placed_tile_adjacency_bonuses or [],
            "requirements": self.requirements or [],
            "required_card_ids": self.required_card_ids or [],
            "play_thresholds": self.play_thresholds or [],
            "court_threshold_modifier": self.court_threshold_modifier,
            "only_playable_next_to": self.only_playable_next_to or [],
            "only_playable_on_terrains": self.only_playable_on_terrains or [],
            "bonuses_by_placing_next_to_building": self.bonuses_by_placing_next_to_building or [],
            "bonuses_by_building_on_terrain_type": self.bonuses_by_building_on_terrain_type or [],
            "bonuses_by_building_adjacent_to_terrain_type": self.bonuses_by_building_adjacent_to_terrain_type or [],
            "adjacent_placement_fee": self.adjacent_placement_fee or 0,
            "adjacent_placement_fee_target_types": self.adjacent_placement_fee_target_types or [],
            "tiers": self.tiers or [],
            "current_tier": self.current_tier,
            "responsible_mining": self.responsible_mining or {},
            "producibles": self.producibles or [],
            "pollution_tag": self.pollution_tag,
            "fee_for_green": self.fee_for_green,
            "lose_card_rule": self.lose_card_rule,
            "steal_card": self.steal_card,
            "poach_employees": self.poach_employees,
            "targeted_leverage": self.targeted_leverage,
            "resource_conversion": self.resource_conversion,
            "effective_pollution_tag": self.effective_pollution_tag,
            "producibles_used": list(self._producibles_used),
            "conversion_used_this_year": self._conversion_used_this_year,
            "tier_upgraded_this_year": self._tier_upgraded_this_year,
            "dodged": self._dodged,
            "deactivated_info": self._deactivated_info,
            "instance_id": self._instance_id,
        }
        return d

    @classmethod
    def from_yaml(cls, data: dict, card_type: str, deck: str) -> Card:
        costs_raw = data.get("costs") or {}
        effect_raw = data.get("effect")
        # Support effect as dict (new platform format) or string (legacy)
        # Use `is not None` to preserve empty dicts {} instead of collapsing to None
        eff_dict = effect_raw if isinstance(effect_raw, dict) else None
        eff_str = effect_raw if isinstance(effect_raw, str) else None

        build_raw = data.get("build")
        first_build = None
        if isinstance(build_raw, list):
            first_build = next((b for b in build_raw if b), None)
        elif build_raw:
            first_build = build_raw

        legacy_factory_refund = int(data.get("factory_refund", 0) or 0)
        legacy_dc_bonus = int(data.get("dc_production_bonus", 0) or 0)
        placed_tile_adjacency_bonuses = data.get("placed_tile_adjacency_bonuses")
        if not placed_tile_adjacency_bonuses:
            placed_tile_adjacency_bonuses = []
            if legacy_factory_refund > 0:
                placed_tile_adjacency_bonuses.append({
                    "build_type": "factory",
                    "production": {"money": legacy_factory_refund},
                })
            if legacy_dc_bonus > 0:
                placed_tile_adjacency_bonuses.append({
                    "build_type": "data_center",
                    "production": {"data_centers": legacy_dc_bonus},
                })
        bonuses_by_placing_next_to_building = data.get("bonuses_by_placing_next_to_building") or []
        if not bonuses_by_placing_next_to_building and legacy_dc_bonus > 0:
            bonuses_by_placing_next_to_building = [{
                "build_type": "data_center",
                "production": {"data_centers": legacy_dc_bonus},
            }]

        return cls(
            name=data["name"],
            id=data.get("id", 0),
            cost=int(round(data.get("cost", 0) or 0)),
            tag=data.get("tag", "") or data.get("type", ""),
            card_type=card_type,
            deck=deck,
            description=data.get("description", ""),
            production=_intify(data.get("production") or {}),
            immediate=_intify(data.get("immediate") or {}),
            effect=_intify(eff_dict) if eff_dict is not None else eff_str,
            starting_resources=_intify(data.get("starting_resources") or {}),
            starting_production=_intify(data.get("starting_production") or {}),
            targets_all=data.get("targets_all", 1),
            target_id=data.get("target_id"),
            target_type=data.get("target_type"),
            compliance=_intify(data.get("compliance") or data.get("penalty") or {}),
            court_penalty=_intify(data.get("court_penalty") or {}),
            court_threshold=data.get("court_threshold", 4),
            conditional_effects=_intify(data.get("conditional_effects") or {}),
            boosts=_intify_bonus_list(data.get("boosts") or []),
            tile_type=data.get("tile_type") or first_build,
            build=build_raw,
            costs=_intify(costs_raw),
            card_color_type=data.get("type", "") or "",
            secondary_card_color_type=(data.get("secondary_type") or data.get("secondary_card_color_type") or None),
            number=data.get("number", 1),
            image=data.get("image", ""),
            payee_card_id=data.get("payee_card_id"),
            starting_tiles=data.get("starting_tiles") or [],
            placed_tile_adjacency_bonuses=_intify_bonus_list(placed_tile_adjacency_bonuses),
            requirements=data.get("requirements") or [],
            required_card_ids=[int(x) for x in (data.get("required_card_ids") or []) if x is not None],
            play_thresholds=cls._parse_play_thresholds(data),
            court_threshold_modifier=data.get("court_threshold_modifier") or None,
            only_playable_next_to=data.get("only_playable_next_to") or [],
            only_playable_on_terrains=data.get("only_playable_on_terrains") or [],
            bonuses_by_placing_next_to_building=_intify_bonus_list(bonuses_by_placing_next_to_building),
            bonuses_by_building_on_terrain_type=_intify_bonus_list(data.get("bonuses_by_building_on_terrain_type") or []),
            bonuses_by_building_adjacent_to_terrain_type=_intify_bonus_list(data.get("bonuses_by_building_adjacent_to_terrain_type") or []),
            adjacent_placement_fee=data.get("adjacent_placement_fee", 0) or 0,
            adjacent_placement_fee_target_types=data.get("adjacent_placement_fee_target_types") or [],
            tiers=_intify_bonus_list(data.get("tiers") or []),
            responsible_mining=_intify(data.get("responsible_mining") or {}),
            producibles=_intify_bonus_list(data.get("producibles") or []),
            pollution_tag=data.get("pollution_tag") or "neutral",
            fee_for_green=_intify(data.get("fee_for_green") or {}) or None,
            lose_card_rule=data.get("lose_card_rule") or None,
            steal_card=data.get("steal_card") or None,
            poach_employees=data.get("poach_employees") or None,
            targeted_leverage=data.get("targeted_leverage") or None,
            resource_conversion=_intify_conversion(data.get("resource_conversion") or None),
        )

    @classmethod
    def _parse_play_thresholds(cls, data: dict) -> list[dict]:
        """Parse play_thresholds from YAML data, with backward compat for min_reputation."""
        thresholds = data.get("play_thresholds") or []
        if thresholds:
            return thresholds
        min_rep = data.get("min_reputation")
        if min_rep is not None and min_rep != 0:
            return [{"key": "reputation", "min": int(min_rep)}]
        return []
