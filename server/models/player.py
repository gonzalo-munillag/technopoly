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
    went_to_court: bool = False
    court_start_ready: bool = False
    year_done: bool = False
    hiring_done: bool = False
    pending_tile: str | None = None
    pending_tile_meta: dict = field(default_factory=dict)
    pending_tile_queue: list[str] = field(default_factory=list, repr=False)
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
                if played.tiers:
                    played.current_tier = 1  # start at tier 1 when played
                self.apply_card_effects(played, game)
                self.cards_played_this_turn += 1
                return played
        return None

    def upgrade_card_tier(self, instance_id: str, game=None) -> dict:
        """Upgrade a played card to the next tier by spending data.

        Tiers list format: [{users, money, data_cost}, ...]  — values are INCREMENTAL.
          current_tier == 0: card not yet played (all locked)
          current_tier == 1: card played, no tier purchased yet
          current_tier == 2: T1 purchased  (tiers[0] applied)
          current_tier == 3: T2 purchased  (tiers[1] applied)
          ...
        Purchasing T1 costs tiers[0].data_cost and gives tiers[0].users + tiers[0].money.
        """
        card = next((c for c in self.played_cards if c is not None and c._instance_id == instance_id), None)
        if not card:
            return {"ok": False, "error": "Card not found in played cards."}
        tiers = card.tiers or []
        if not tiers:
            return {"ok": False, "error": "Card has no tier system."}
        if card.current_tier == 0:
            return {"ok": False, "error": "Play the card before purchasing a tier."}
        if card._tier_upgraded_this_year:
            return {"ok": False, "error": "Already upgraded this card's tier this year. Wait for the next year."}
        next_idx = card.current_tier - 1  # 0-based index of tier to purchase
        if next_idx >= len(tiers):
            return {"ok": False, "error": "Already at maximum tier."}
        tier = tiers[next_idx]
        data_cost = tier.get("data_cost", 0)
        if self.resources.get("data", 0) < data_cost:
            return {"ok": False, "error": f"Not enough data — need {data_cost}PB to upgrade."}
        self.resources["data"] = self.resources.get("data", 0) - data_cost
        _PRODUCTION_KEYS = {"HR", "data_centers", "ad_campaigns"}
        resource_gains = {}
        production_gains = {}
        for k, v in tier.items():
            if k == "data_cost" or not v:
                continue
            if k in _PRODUCTION_KEYS:
                production_gains[k] = v
            elif k == "money" and "users" not in tier and not any(rk in tier for rk in _PRODUCTION_KEYS):
                production_gains[k] = v
            elif k == "money" and any(rk in tier for rk in ("users", "engineers", "suits", "servers", "ads", "reputation", "data")):
                production_gains[k] = v
            else:
                resource_gains[k] = v

        users_gained = 0
        for res, amt in resource_gains.items():
            if res == "users":
                users_gained = amt
                self.gain_users(amt, game)
                mod = self.reputation_modifier()
                if mod != 0:
                    delta = max(-amt, mod)
                    self.users = max(0, self.users + delta)
                    if game and delta > 0:
                        game.user_pool = max(0, game.user_pool - delta)
            else:
                self.resources[res] = self.resources.get(res, 0) + amt

        for res, amt in production_gains.items():
            self.production[res] = self.production.get(res, 0) + amt

        card.current_tier += 1
        card._tier_upgraded_this_year = True
        return {
            "ok": True,
            "resource_gains": resource_gains,
            "production_gains": production_gains,
            "users_gained": users_gained,
            "new_tier": card.current_tier,
            "card_name": card.name,
        }

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
            {"value": 10, "direction": "gte", "modifier": 2},
            {"value": 5,  "direction": "gte", "modifier": 1},
            {"value": -5, "direction": "lte", "modifier": -1},
            {"value": -10,"direction": "lte", "modifier": -2},
        ])
        for t in thresh:
            # New format: {value, direction, modifier}
            if "value" in t and "direction" in t:
                if t["direction"] == "gte" and rep >= t["value"]:
                    return t["modifier"]
                if t["direction"] == "lte" and rep <= t["value"]:
                    return t["modifier"]
            # Legacy format backward-compat: {min_rep/max_rep, modifier}
            elif "min_rep" in t and rep >= t["min_rep"]:
                return t["modifier"]
            elif "max_rep" in t and rep <= t["max_rep"]:
                return t["modifier"]
        return 0

    def gain_users(self, amount: int, pool: "Game | None" = None) -> int:
        """Add users directly. No reputation modifier — caller is responsible for applying it once.
        Users are floored at 0; they cannot go negative."""
        if pool is not None and amount > 0:
            pool.user_pool = max(0, pool.user_pool - amount)
        self.users = max(0, self.users + amount)
        return amount

    def apply_card_effects(self, card: Card, game=None):
        users_before = self.users

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

        # Apply reputation modifier exactly once, after every user gain from this card play
        users_gained = self.users - users_before
        if users_gained > 0:
            mod = self.reputation_modifier()
            if mod != 0:
                # mod adds/subtracts flat users per gain event (not per individual card)
                delta = max(-users_gained, mod)  # can't lose more than was gained
                self.users += delta
                if game and delta > 0:
                    game.user_pool = max(0, game.user_pool - delta)

    def _apply_bonus(self, bonus: dict, multiplier: int, game=None):
        """Apply a bonus dict (immediate resources) scaled by multiplier."""
        for resource, amount in bonus.items():
            total = (amount or 0) * multiplier
            if not total:
                continue
            if resource == "users":
                self.gain_users(total, game)
            elif resource == "reputation":
                rep_min, rep_max = self._rep_bounds()
                pool = getattr(self, self._get_pool(resource))
                pool[resource] = max(rep_min, min(rep_max, pool.get(resource, 0) + total))
            else:
                pool = getattr(self, self._get_pool(resource))
                pool[resource] = pool.get(resource, 0) + total

    def _apply_production_bonus(self, production: dict, multiplier: int):
        """Add production values (yearly) scaled by multiplier directly to self.production."""
        for resource, amount in production.items():
            total = (amount or 0) * multiplier
            if not total:
                continue
            self.production[resource] = self.production.get(resource, 0) + total

    def _ensure_activation_slots(self, card: Card) -> list:
        """Return the activation-count list for a card instance, creating it if needed.

        Keyed by card._instance_id — a UUID assigned at Card creation time.
        This is stable across moves (hand → played_cards) and is NEVER reused,
        unlike id(card) whose memory address can be recycled after garbage collection
        (which caused wrong initial counts when a new card landed on a discarded card's address)."""
        key = card._instance_id
        if key not in self._boost_activations:
            self._boost_activations[key] = [0] * len(card.boosts or [])
        return self._boost_activations[key]

    def _apply_boosts(self, card: Card, game=None):
        """Apply card boosts in two directions.

        Each card instance tracks its own activation counts via _boost_activations,
        keyed by id(card) so two copies of the same card never share state.

        Rules per boost type:
          target_id   — no cap; fires once for every matching card, both when
                        this card is first played (§1) and retroactively whenever
                        a new matching card is played by this player (§2).
          target_type — fires for every matching-type card up to target_count
                        (inclusive).  target_count=0 means unlimited.
        """
        already_played = [c for c in self.played_cards if c is not None and c is not card]

        # ── §1. New card's own boosts vs already-played cards ────────────────
        slots = self._ensure_activation_slots(card)
        for i, boost in enumerate(card.boosts or []):
            bonus = boost.get("bonus") or {}
            production = boost.get("production") or {}
            if not bonus and not production:
                continue

            target_id = boost.get("target_id")
            has_target_id = target_id is not None and target_id != 0

            if has_target_id:
                # target_id: fire once per already-played matching card, no cap
                ids = target_id if isinstance(target_id, list) else [target_id]
                matching = sum(1 for c in already_played if getattr(c, "id", None) in ids)
                new_fires = max(0, matching - slots[i])
                if new_fires:
                    slots[i] += new_fires
                    if bonus: self._apply_bonus(bonus, new_fires, game)
                    if production: self._apply_production_bonus(production, new_fires)
            else:
                # target_type: fire up to target_count matching cards (0 = unlimited)
                target_type = boost.get("target_type")
                if not target_type:
                    continue
                types = target_type if isinstance(target_type, list) else [target_type]
                matching = sum(1 for c in already_played if getattr(c, "card_color_type", None) in types)
                target_count = int(boost.get("target_count") or 0)
                if target_count:
                    matching = min(matching, target_count)
                new_fires = max(0, matching - slots[i])
                if new_fires:
                    slots[i] += new_fires
                    if bonus: self._apply_bonus(bonus, new_fires, game)
                    if production: self._apply_production_bonus(production, new_fires)

        # ── §2. Retroactive: previously played cards' boosts targeting this card ─
        for prev in already_played:
            prev_slots = self._ensure_activation_slots(prev)
            for i, boost in enumerate(prev.boosts or []):
                bonus = boost.get("bonus") or {}
                production = boost.get("production") or {}
                if not bonus and not production:
                    continue

                target_id = boost.get("target_id")
                has_target_id = target_id is not None and target_id != 0

                if has_target_id:
                    # target_id: always fire — no cap for ID-targeted boosts
                    ids = target_id if isinstance(target_id, list) else [target_id]
                    if getattr(card, "id", None) in ids:
                        prev_slots[i] += 1
                        if bonus: self._apply_bonus(bonus, 1, game)
                        if production: self._apply_production_bonus(production, 1)
                else:
                    # target_type: fire only if cap not yet reached
                    target_type = boost.get("target_type")
                    if not target_type:
                        continue
                    types = target_type if isinstance(target_type, list) else [target_type]
                    if getattr(card, "card_color_type", None) in types:
                        target_count = int(boost.get("target_count") or 0)
                        if not target_count or prev_slots[i] < target_count:
                            prev_slots[i] += 1
                            if bonus: self._apply_bonus(bonus, 1, game)
                            if production: self._apply_production_bonus(production, 1)

    _PRODUCTION_ONLY = {"HR", "data_centers", "ad_campaigns"}
    _PRODUCTION_MAP = {"data_centers": "servers", "ad_campaigns": "ads"}

    def collect_production(
        self,
        money_users_trigger: int = 10,
        data_per_users: int = 200,
        data_users_trigger: int = 10,
        rep_resource_values: dict | None = None,
        rep_production_values: dict | None = None,
    ) -> bool:
        """Apply yearly production. Returns True if the player goes bankrupt this year.

        Bankruptcy: negative money production drives money to 0 or below.
        Users are always clamped to >= 0.
        """
        for resource, amount in self.production.items():
            target = self._PRODUCTION_MAP.get(resource)
            if target:
                self.resources[target] = self.resources.get(target, 0) + amount
            elif resource not in self._PRODUCTION_ONLY:
                self.resources[resource] = self.resources.get(resource, 0) + amount

        # User income from captured users (always non-negative)
        if money_users_trigger and self.users:
            self.resources["money"] = self.resources.get("money", 0) + self.users // money_users_trigger

        # Data accumulation: configurable PB/yr every N users (N in M-users units)
        if self.users and data_per_users and data_users_trigger > 0:
            data_gain = (self.users // data_users_trigger) * data_per_users
            self.resources["data"] = self.resources.get("data", 0) + data_gain

        # Reputation-threshold multiplier effects (parameterized).
        # For each configured key: delta = configured_value * reputation_modifier.
        rep_mod = self.reputation_modifier()
        if rep_mod:
            for resource, base in (rep_resource_values or {}).items():
                delta = int(base or 0) * rep_mod
                if not delta:
                    continue
                if resource == "users":
                    self.users = max(0, self.users + delta)
                elif resource in PRODUCTION_KEYS:
                    self.production[resource] = self.production.get(resource, 0) + delta
                else:
                    self.resources[resource] = self.resources.get(resource, 0) + delta
            for resource, base in (rep_production_values or {}).items():
                delta = int(base or 0) * rep_mod
                if not delta:
                    continue
                self.production[resource] = self.production.get(resource, 0) + delta

        # Clamp users to zero
        self.users = max(0, self.users)

        # Check bankruptcy: negative money production that drives money <= 0
        money_prod = self.production.get("money", 0)
        if money_prod < 0 and self.resources.get("money", 0) <= 0:
            self.resources["money"] = 0
            return True
        return False

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

    @staticmethod
    def _rep_bounds() -> tuple[int, int]:
        """Return (rep_min, rep_max) derived from the configured thresholds."""
        from .game import P
        thresh = P("reputation_thresholds", [
            {"value": 10, "direction": "gte", "modifier": 2},
            {"value": 5,  "direction": "gte", "modifier": 1},
            {"value": -5, "direction": "lte", "modifier": -1},
            {"value": -10,"direction": "lte", "modifier": -2},
        ])
        lte_vals = [t["value"] for t in thresh if t.get("direction") == "lte"]
        gte_vals = [t["value"] for t in thresh if t.get("direction") == "gte"]
        # Legacy format compat
        lte_vals += [t["max_rep"] for t in thresh if "max_rep" in t]
        gte_vals += [t["min_rep"] for t in thresh if "min_rep" in t]
        rep_min = min(lte_vals) if lte_vals else -10
        rep_max = max(gte_vals) if gte_vals else 10
        return rep_min, rep_max

    def _deduct(self, res: str, amt: int):
        if res == "users":
            self.users = max(0, self.users - amt)
            return
        pool = getattr(self, self._get_pool(res))
        if res == "reputation":
            # Reputation costs always subtract from current reputation,
            # regardless of whether YAML entered 3 or -3.
            rep_min, _ = self._rep_bounds()
            new_val = pool.get(res, 0) - abs(amt)
            pool[res] = max(rep_min, new_val)
            return
        if amt < 0:
            # Negative costs (e.g. reputation: -4) are penalties — they reduce
            # the resource by |amt|, i.e. add the negative value directly.
            new_val = pool.get(res, 0) + amt
        else:
            new_val = pool.get(res, 0) - amt
        pool[res] = new_val

    _COST_SKIP = {"fee", "fee_card_id", "fee_card_type", "fee_company_type", "payee_card_id"}

    def _owns_fee_card(self, card: Card) -> bool:
        """True if this player owns the fee target — meaning the fee is waived.
        fee_card_id   → player has played that specific card.
        fee_card_type → player has played any card of that type.
        fee_company_type → player's chosen company is of that type."""
        if not card.fee:
            return False
        if card.fee_card_id:
            return any(getattr(c, "id", None) == card.fee_card_id for c in self.played_cards if c is not None)
        if card.fee_card_type:
            return any(getattr(c, "card_color_type", None) == card.fee_card_type for c in self.played_cards if c is not None)
        if card.fee_company_type:
            return bool(self.company and self.company.card_color_type == card.fee_company_type)
        return False

    def check_requirements(self, card: "Card") -> str | None:
        """Returns error string if card requirements are not met, else None."""
        reqs = getattr(card, "requirements", None) or []
        for req_type in reqs:
            if not req_type:
                continue
            has_played = any(getattr(c, "card_color_type", None) == req_type for c in self.played_cards if c is not None)
            has_company = bool(self.company and self.company.card_color_type == req_type)
            if not has_played and not has_company:
                return f"Requirement not met: play a '{req_type}' card first."
        min_rep = getattr(card, "min_reputation", None)
        if min_rep is not None:
            current_rep = self.resources.get("reputation", 0)
            if current_rep < min_rep:
                return f"Requires at least {min_rep} reputation (you have {current_rep})."
        return None

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
            # Reputation is not a blocking resource — costs always apply (floored at _REP_MIN).
            if res == "reputation":
                continue
            # Negative cost amounts are penalties — they always apply and never block play.
            if amt < 0:
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
            if any(getattr(c, "id", None) in target_ids for c in self.played_cards if c is not None):
                return True
        if regulation.target_type:
            if any(getattr(c, "card_color_type", None) == regulation.target_type for c in self.played_cards if c is not None):
                return True
        return False

    def find_targeted_cards(self, regulation: Card) -> list[Card]:
        """Find cards in played_cards that match the regulation's target."""
        result = []
        target_ids = regulation.target_id
        if target_ids is not None:
            if not isinstance(target_ids, list):
                target_ids = [target_ids]
            result.extend(c for c in self.played_cards if c is not None and getattr(c, "id", None) in target_ids)
        if regulation.target_type:
            result.extend(c for c in self.played_cards
                          if c is not None and getattr(c, "card_color_type", None) == regulation.target_type and c not in result)
        return result

    def clamp_resources(self):
        """Ensure no resource or production goes below 0 (except HR and reputation)."""
        rep_min, rep_max = self._rep_bounds()
        for k in self.resources:
            if k == "reputation":
                self.resources[k] = max(rep_min, min(rep_max, self.resources[k]))
                continue
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
            "hand": [c.to_dict() for c in self.hand if c is not None],
            "played_cards": [
                {**c.to_dict(), "boost_fires": self._boost_activations.get(c._instance_id, [])}
                for c in self.played_cards if c is not None
            ],
            "resources": self.resources,
            "production": self.production,
            "users": self.users,
            "company": self.company.to_dict() if self.company else None,
            "cards_played_this_turn": self.cards_played_this_turn,
            "ready": self.ready,
            "draft_pool": [c.to_dict() for c in self.draft_pool if c is not None],
            "regulation_resolved": self.regulation_resolved,
            "went_to_court": self.went_to_court,
            "has_fuckups": self.has_pending_fuckups(),
            "year_done": self.year_done,
            "hiring_done": self.hiring_done,
            "pending_tile": self.pending_tile,
            "color": self.color,
        }
