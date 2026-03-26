from __future__ import annotations
from dataclasses import dataclass, field

from .card import Card, OPTIONAL_COST_PAIRS

RESOURCE_KEYS = ["money", "engineers", "suits", "servers", "ads", "reputation"]
PRODUCTION_KEYS = ["HR", "data_centers", "ad_campaigns"]


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
    hiring_done: bool = False
    pending_tile: str | None = None
    pending_tile_meta: dict = field(default_factory=dict)
    color: str = "#c9a227"
    users: int = 0
    _remaining_starting_tiles: list = field(default_factory=list, repr=False)
    # Tracks how many times each boost has fired: {card_id: [count_per_boost_index]}
    _boost_activations: dict = field(default_factory=dict, repr=False)

    def __post_init__(self):
        if not self.resources:
            self.resources = {k: 0 for k in RESOURCE_KEYS}
        if not self.production:
            self.production = {k: 0 for k in PRODUCTION_KEYS}

    def set_company(self, card: Card, game=None):
        self.company = card
        for resource, amount in card.starting_resources.items():
            if resource == "users":
                # Set directly — no reputation modifier on starting resources
                taken = game.take_users(amount) if game else amount
                self.users += taken
            else:
                self.resources[resource] = self.resources.get(resource, 0) + amount
        for resource, amount in card.starting_production.items():
            self.production[resource] = self.production.get(resource, 0) + amount

    def add_to_hand(self, card: Card):
        self.hand.append(card)

    def play_card(self, card_name: str, game=None) -> Card | None:
        for i, card in enumerate(self.hand):
            if card.name == card_name:
                played = self.hand.pop(i)
                self.played_cards.append(played)
                self.apply_card_effects(played, game)
                self.cards_played_this_turn += 1
                return played
        return None

    def remove_from_hand(self, card_name: str) -> Card | None:
        """Remove a card from hand without adding to played_cards."""
        for i, card in enumerate(self.hand):
            if card.name == card_name:
                return self.hand.pop(i)
        return None

    def reputation_modifier(self, thresholds=None) -> int:
        from .game import P
        rep = self.resources.get("reputation", 0)
        thresh = thresholds or P("reputation_thresholds", [
            {"min_rep": 10, "modifier": 2},
            {"min_rep": 5, "modifier": 1},
            {"max_rep": -10, "modifier": -2},
            {"max_rep": -5, "modifier": -1},
        ])
        for t in thresh:
            if "min_rep" in t and rep >= t["min_rep"]:
                return t["modifier"]
            if "max_rep" in t and rep <= t["max_rep"]:
                return t["modifier"]
        return 0

    def gain_users(self, amount: int, pool: "Game | None" = None) -> int:
        mod = self.reputation_modifier()
        total = max(0, amount + mod) if amount > 0 else amount
        if pool is not None:
            total = pool.take_users(total)
        self.users += total
        return total

    def apply_card_effects(self, card: Card, game=None):
        SKIP = {"payee_card_id", "users"}
        if isinstance(card.effect, dict):
            user_gain = card.effect.get("users", 0)
            if user_gain:
                self.gain_users(user_gain, game)
            for resource, amount in card.effect.items():
                if not amount or resource in SKIP:
                    continue
                p = getattr(self, self._get_pool(resource))
                p[resource] = p.get(resource, 0) + amount
        for resource, amount in card.immediate.items():
            if resource == "users" and amount:
                self.gain_users(amount, game)
            else:
                self.resources[resource] = self.resources.get(resource, 0) + amount
        for resource, amount in card.production.items():
            self.production[resource] = self.production.get(resource, 0) + amount
        self._apply_boosts(card, game)

    def _apply_bonus(self, bonus: dict, multiplier: int, game=None):
        """Apply a bonus dict scaled by multiplier."""
        for resource, amount in bonus.items():
            total = (amount or 0) * multiplier
            if not total:
                continue
            if resource == "users":
                self.gain_users(total, game)
            else:
                pool = getattr(self, self._get_pool(resource))
                pool[resource] = pool.get(resource, 0) + total

    def _ensure_activation_slots(self, card: Card) -> list:
        """Return the activation-count list for a card, creating it if needed."""
        cid = card.id
        if cid not in self._boost_activations:
            self._boost_activations[cid] = [0] * len(card.boosts or [])
        return self._boost_activations[cid]

    def _apply_boosts(self, card: Card, game=None):
        """Apply card boosts with forward-firing retroactive support.

        Two directions are handled:
          1. NEW CARD's own boosts  → fire based on already-played cards (as before).
          2. PREVIOUS cards' boosts → if any target the newly played card and haven't
             fired yet (or haven't hit their cap), fire them now.

        Activation counts are stored in _boost_activations so each boost fires at
        most once for target_id, or at most target_count times for target_type.
        target_id and target_type are mutually exclusive per boost entry.
        """
        already_played = [c for c in self.played_cards if c is not card]

        # ── 1. New card's own boosts ─────────────────────────────────────────
        slots = self._ensure_activation_slots(card)
        for i, boost in enumerate(card.boosts or []):
            bonus = boost.get("bonus") or {}
            if not bonus:
                continue

            target_id = boost.get("target_id")
            has_target_id = target_id is not None and target_id != 0

            if has_target_id:
                ids = target_id if isinstance(target_id, list) else [target_id]
                matching = sum(1 for c in already_played if c.id in ids)
                target_count = int(boost.get("target_count") or 0)
                if target_count:
                    matching = min(matching, target_count)
                # Fire once per matching card already played (not yet counted)
                new_fires = max(0, matching - slots[i])
                if new_fires:
                    slots[i] += new_fires
                    self._apply_bonus(bonus, new_fires, game)
            else:
                target_type = boost.get("target_type")
                if not target_type:
                    continue
                types = target_type if isinstance(target_type, list) else [target_type]
                matching = sum(1 for c in already_played if c.card_color_type in types)
                target_count = int(boost.get("target_count") or 0)
                if target_count:
                    matching = min(matching, target_count)
                # Only apply the portion not yet counted
                new_fires = max(0, matching - slots[i])
                if new_fires:
                    slots[i] += new_fires
                    self._apply_bonus(bonus, new_fires, game)

        # ── 2. Retroactive: previous cards' boosts that now target the new card ─
        for prev in already_played:
            prev_slots = self._ensure_activation_slots(prev)
            for i, boost in enumerate(prev.boosts or []):
                bonus = boost.get("bonus") or {}
                if not bonus:
                    continue

                target_id = boost.get("target_id")
                has_target_id = target_id is not None and target_id != 0

                if has_target_id:
                    ids = target_id if isinstance(target_id, list) else [target_id]
                    # Fire once if the new card is one of the targets and not yet activated
                    if card.id in ids and prev_slots[i] == 0:
                        prev_slots[i] = 1
                        self._apply_bonus(bonus, 1, game)
                else:
                    target_type = boost.get("target_type")
                    if not target_type:
                        continue
                    types = target_type if isinstance(target_type, list) else [target_type]
                    # Fire once more if the new card matches the type and cap allows
                    if card.card_color_type in types:
                        target_count = int(boost.get("target_count") or 0)
                        if not target_count or prev_slots[i] < target_count:
                            prev_slots[i] += 1
                            self._apply_bonus(bonus, 1, game)

    _PRODUCTION_ONLY = {"HR", "data_centers", "ad_campaigns"}
    _PRODUCTION_MAP = {"data_centers": "servers", "ad_campaigns": "ads"}

    def collect_production(self, money_per_users: int = 20):
        for resource, amount in self.production.items():
            target = self._PRODUCTION_MAP.get(resource)
            if target:
                self.resources[target] = self.resources.get(target, 0) + amount
            elif resource not in self._PRODUCTION_ONLY:
                self.resources[resource] = self.resources.get(resource, 0) + amount
        if money_per_users and self.users:
            self.resources["money"] = self.resources.get("money", 0) + self.users // money_per_users

    def can_afford(self, card: Card) -> bool:
        return self.resources.get("money", 0) >= card.cost

    def _get_pool(self, res: str) -> str:
        """Return 'production' if the resource lives there, else 'resources'."""
        return "production" if res in PRODUCTION_KEYS else "resources"

    def _get_amount(self, res: str) -> int:
        if res == "users":
            return self.users
        pool = getattr(self, self._get_pool(res))
        return pool.get(res, 0)

    def _deduct(self, res: str, amt: int):
        if res == "users":
            self.users = max(0, self.users - amt)
            return
        pool = getattr(self, self._get_pool(res))
        pool[res] = pool.get(res, 0) - amt

    _COST_SKIP = {"fee", "fee_card_id", "payee_card_id"}

    def _owns_fee_card(self, card: Card) -> bool:
        """True if this player has already played the card referenced by fee_card_id."""
        if not card.fee or not card.fee_card_id:
            return False
        return any(c.id == card.fee_card_id for c in self.played_cards)

    def can_afford_costs(self, card: Card, use_optional: dict | None = None) -> str | None:
        costs = card.costs
        if not costs:
            if card.cost > self.resources.get("money", 0):
                return "Not enough money."
            return None

        total_money = 0
        for res, amt in costs.items():
            if not amt or res in self._COST_SKIP:
                continue
            if res == "money":
                total_money += amt
                continue
            if self._get_amount(res) < amt:
                return f"Not enough {res} (need {amt}, have {self._get_amount(res)})."

        if card.fee and not self._owns_fee_card(card):
            total_money += card.fee

        if total_money > self.resources.get("money", 0):
            return f"Not enough $ (need ${total_money}, have ${self.resources.get('money', 0)})."
        return None

    def pay_costs(self, card: Card, use_optional: dict | None = None):
        costs = card.costs
        if not costs:
            fee = 0 if self._owns_fee_card(card) else (card.fee or 0)
            total = card.cost + fee
            self.resources["money"] = self.resources.get("money", 0) - total
            return

        total_money = 0
        for res, amt in costs.items():
            if not amt or res in self._COST_SKIP:
                continue
            if res == "money":
                total_money += amt
                continue
            self._deduct(res, amt)

        if card.fee and not self._owns_fee_card(card):
            total_money += card.fee

        self.resources["money"] = self.resources.get("money", 0) - total_money

    def spend(self, amount: int, resource: str = "money") -> bool:
        if self.resources.get(resource, 0) >= amount:
            self.resources[resource] -= amount
            return True
        return False

    def apply_penalty(self, penalty: dict[str, int], game=None):
        for resource, amount in penalty.items():
            if resource == "users":
                if amount > 0:
                    self.gain_users(amount, game)
                else:
                    self.users = max(0, self.users + amount)
            else:
                self.resources[resource] = self.resources.get(resource, 0) + amount
        self.clamp_resources()

    def has_pending_fuckups(self) -> bool:
        return any(c.card_type == "fuck_up" for c in self.hand)

    def get_fuckup_cards(self) -> list[Card]:
        return [c for c in self.hand if c.card_type == "fuck_up"]

    def is_affected_by_regulation(self, regulation: Card) -> bool:
        if regulation is None:
            return False
        if regulation.targets_all:
            return True
        target_ids = regulation.target_id
        if target_ids is not None:
            if not isinstance(target_ids, list):
                target_ids = [target_ids]
            if any(c.id in target_ids for c in self.played_cards):
                return True
        if regulation.target_type:
            if any(c.card_color_type == regulation.target_type for c in self.played_cards):
                return True
        return False

    def find_targeted_cards(self, regulation: Card) -> list[Card]:
        """Find cards in played_cards that match the regulation's target."""
        result = []
        target_ids = regulation.target_id
        if target_ids is not None:
            if not isinstance(target_ids, list):
                target_ids = [target_ids]
            result.extend(c for c in self.played_cards if c.id in target_ids)
        if regulation.target_type:
            result.extend(c for c in self.played_cards
                          if c.card_color_type == regulation.target_type and c not in result)
        return result

    def clamp_resources(self):
        """Ensure no resource or production goes below 0 (except HR)."""
        for k in self.resources:
            if self.resources[k] < 0:
                self.resources[k] = 0
        for k in self.production:
            if k == "HR":
                continue
            if self.production[k] < 0:
                self.production[k] = 0

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
            "users": self.users,
            "company": self.company.to_dict() if self.company else None,
            "cards_played_this_turn": self.cards_played_this_turn,
            "ready": self.ready,
            "draft_pool": [c.to_dict() for c in self.draft_pool],
            "regulation_resolved": self.regulation_resolved,
            "has_fuckups": self.has_pending_fuckups(),
            "year_done": self.year_done,
            "hiring_done": self.hiring_done,
            "pending_tile": self.pending_tile,
            "color": self.color,
        }
