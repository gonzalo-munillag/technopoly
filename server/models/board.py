from __future__ import annotations
from dataclasses import dataclass, field

# Sentinel: means "caller did not supply a value — keep whatever is stored"
_UNSET = object()

TILE_TYPES = {
    "power_plant", "pv_power_plant", "wind_power_plant", "solar_thermal",
    "factory", "data_center", "store", "ad_campaign",
    "office", "lobby_group", "rare_metal_mine", "hydroelectric_power_plant",
    "satellite_solar", "satellite_dc", "launching_pad",
}

# Tile types that behave as power plants for synergy calculations
_POWER_PLANT_TYPES = {"power_plant", "pv_power_plant", "wind_power_plant", "solar_thermal", "satellite_solar"}

TILE_BASE_BONUSES = {
    "power_plant":               {},
    "pv_power_plant":            {},  # boosts adjacent DCs (same synergy as power_plant)
    "wind_power_plant":          {},  # boosts adjacent DCs (same synergy as power_plant)
    "solar_thermal":             {},  # boosts adjacent DCs (same synergy as power_plant)
    "factory":                   {},
    "data_center":               {"production": {"data_centers": 1}},
    "store":                     {"production": {"ad_campaigns": 1}},
    "ad_campaign":               {"production": {"ad_campaigns": 1}},
    "office":                    {"production": {"HR": 1}},
    "lobby_group":               {},
    "rare_metal_mine":           {"production": {"money": 10}},
    "hydroelectric_power_plant": {"production": {"data_centers": 2}},
    "satellite_solar":           {},                                    # boosts adjacent DCs (power plant synergy)
    "satellite_dc":              {"production": {"data_centers": 3}},  # orbital data center
    "launching_pad":             {},                                    # enables satellite placement
}

TILE_LABELS = {
    "power_plant":               "PWR",
    "pv_power_plant":            "PV",
    "wind_power_plant":          "WND",
    "solar_thermal":             "CSP",
    "factory":                   "FAC",
    "data_center":               "DC",
    "store":                     "STO",
    "ad_campaign":               "AD",
    "office":                    "OFC",
    "lobby_group":               "LOB",
    "rare_metal_mine":           "RMM",
    "hydroelectric_power_plant": "HYD",
    "satellite_solar":           "SAT☀",
    "satellite_dc":              "SAT🖥",
    "launching_pad":             "🚀",
}

# Pointy-top, odd-r offset neighbor directions
_EVEN_ROW_DIRS = [(-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (0, 1)]
_ODD_ROW_DIRS  = [(-1, 1), (-1, 0), (0, -1), (1, 0), (1, 1), (0, 1)]

# 100 hex tiles shaped roughly like the continental USA
_USA_COORDS = [
    *[(0, c) for c in range(3, 13)],        # 10 — northern border
    *[(1, c) for c in range(2, 14)],         # 12
    *[(2, c) for c in range(1, 15)],         # 14
    *[(3, c) for c in range(0, 15)],         # 15 — widest
    *[(4, c) for c in range(0, 14)],         # 14
    *[(5, c) for c in range(1, 14)],         # 13
    *[(6, c) for c in range(2, 13)],         # 11
    *[(7, c) for c in range(3, 11)],         # 8
    *[(8, c) for c in range(5, 8)],          # 3  — Florida tip
]

_SPECIAL = {
    (3, 0):  {"terrain": "city",       "name": "San Francisco"},
    (1, 13): {"terrain": "city",       "name": "New York"},
    (4, 12): {"terrain": "government", "name": "Washington DC"},
    (0, 7):  {"terrain": "lake",       "name": "Great Lakes"},
    (0, 8):  {"terrain": "lake",       "name": "Great Lakes"},
    (1, 7):  {"terrain": "lake",       "name": "Great Lakes"},
    (7, 9):  {"terrain": "lake",       "name": "Everglades"},
}


VALID_TERRAINS = {
    "empty", "city", "lake", "sea", "government", "commercial",
    "sun", "wind", "gas_reserve", "coal", "wall", "rare_metal_mine",
    "natural_park", "offshore_wind", "offshore_solar", "space", "launching_pad",
    "mountain",
}

# Terrains where nothing can be built
_NO_BUILD_TERRAINS = {"government", "city", "wall", "mountain"}
# Terrains open to normal non-commercial, non-lake, non-offshore tiles
_OPEN_TERRAINS = {"empty", "sun", "wind", "gas_reserve", "coal", "natural_park"}
# Tiles restricted to commercial terrain only
_COMMERCIAL_ONLY = {"store", "lobby_group", "office"}
# Tiles restricted to rare_metal_mine terrain only
_MINE_ONLY = {"rare_metal_mine"}
# Tiles restricted to lake terrain only
_LAKE_ONLY = {"hydroelectric_power_plant"}
# Offshore terrains → specific power plant types only
_OFFSHORE_WIND_TILES  = {"wind_power_plant"}     # offshore_wind terrain
_OFFSHORE_SOLAR_TILES = {"pv_power_plant"}       # offshore_solar terrain
# Sea → data_center only
_SEA_BUILDABLE = {"data_center"}
# Space terrain → allowed tile types
_SPACE_TERRAIN_TILES: dict[str, set] = {
    "space": {"satellite_solar", "satellite_dc"},
}
_SPACE_TILES = {"satellite_solar", "satellite_dc"}
_SATELLITE_STACKABLE: set = set()  # stacking removed; two distinct types cover both roles


# ── Bonus normalization helpers ───────────────────────────────────────────────
# Bonuses can be stored as:
#   Old build_bonuses dict:    {"immediate": {...}, "production": {...}}
#   Old adjacency_bonuses dict: {"money": 5, ...}  (flat)
#   New list format:           [{"build_type": str|None, "immediate": {...}, "production": {...}}, ...]
# These helpers normalise both old formats to the new list format.

def _normalize_build_bonuses(bb) -> list:
    if isinstance(bb, list):
        return bb
    if isinstance(bb, dict):
        imm  = bb.get("immediate") or {}
        prod = bb.get("production") or {}
        if not imm and not prod:
            return []
        return [{"build_type": None, "immediate": imm, "production": prod}]
    return []


def _normalize_adjacency_bonuses(ab) -> list:
    if isinstance(ab, list):
        return ab
    if isinstance(ab, dict) and ab:
        # Old format can be nested {"immediate": {...}} or flat {"money": 5}
        if "immediate" in ab or "production" in ab:
            return [{"build_type": None, "immediate": ab.get("immediate") or {},
                     "production": ab.get("production") or {}}]
        return [{"build_type": None, "immediate": dict(ab), "production": {}}]
    return []


def _make_tile(row: int, col: int, terrain: str = "empty",
               name: str = "", build_bonuses: dict | None = None,
               adjacency_bonuses: dict | None = None,
               requirements: list | None = None,
               only_build: list | None = None) -> dict:
    return {
        "row": row, "col": col,
        "terrain": terrain,
        "name": name,
        "placed_tile": None,
        "build_bonuses": build_bonuses or {"immediate": {}, "production": {}},
        "adjacency_bonuses": adjacency_bonuses or {},
        "requirements": requirements or [],  # list of card types player must have played
        "only_build": only_build,             # None=all allowed; []=none; [...]= whitelist
    }


@dataclass
class Board:
    _tiles: dict = field(default_factory=dict, repr=False)

    def __post_init__(self):
        if not self._tiles:
            self._build()

    def _build(self):
        for r, c in _USA_COORDS:
            sp = _SPECIAL.get((r, c))
            if sp:
                self._tiles[(r, c)] = _make_tile(r, c, sp["terrain"], sp["name"])
            else:
                self._tiles[(r, c)] = _make_tile(r, c)

    def set_tile_terrain(self, row: int, col: int, terrain: str,
                         name: str = "",
                         build_bonuses: dict | None = None,
                         adjacency_bonuses: dict | None = None,
                         requirements: list | None = None,
                         only_build=_UNSET) -> bool:
        t = self._tiles.get((row, col))
        if not t or terrain not in VALID_TERRAINS:
            return False
        t["terrain"] = terrain
        t["name"] = name
        t["placed_tile"] = None
        if build_bonuses is not None:
            t["build_bonuses"] = build_bonuses
        if adjacency_bonuses is not None:
            t["adjacency_bonuses"] = adjacency_bonuses
        if requirements is not None:
            t["requirements"] = requirements
        if only_build is not _UNSET:  # None=all allowed, []=none, [...]= whitelist
            t["only_build"] = only_build
        return True

    def set_terrain_type_properties(self, terrain: str,
                                    only_build=_UNSET,
                                    requirements: list | None = None,
                                    build_bonuses: dict | None = None,
                                    adjacency_bonuses: dict | None = None) -> int:
        """Apply properties to ALL tiles with the given terrain. Returns count updated.
        only_build=_UNSET → don't touch; None=all allowed; []=none; [...]= whitelist.
        build_bonuses/adjacency_bonuses=None → don't touch."""
        count = 0
        for t in self._tiles.values():
            if t["terrain"] == terrain:
                if only_build is not _UNSET:
                    t["only_build"] = list(only_build) if only_build is not None else None
                if requirements is not None:
                    t["requirements"] = list(requirements)
                if build_bonuses is not None:
                    t["build_bonuses"] = build_bonuses
                if adjacency_bonuses is not None:
                    t["adjacency_bonuses"] = adjacency_bonuses
                count += 1
        return count

    MAX_ROWS = 14
    MIN_ROW = -8  # allow up to 8 rows of "space" above the USA map

    def add_tile(self, row: int, col: int) -> bool:
        if (row, col) in self._tiles:
            return False
        if row < self.MIN_ROW or row >= self.MAX_ROWS:
            return False
        self._tiles[(row, col)] = _make_tile(row, col)
        return True

    def remove_tile(self, row: int, col: int) -> bool:
        if (row, col) not in self._tiles:
            return False
        del self._tiles[(row, col)]
        return True

    def get_config(self) -> list[dict]:
        out = []
        for t in self._tiles.values():
            entry = {
                "row": t["row"], "col": t["col"],
                "terrain": t["terrain"], "name": t["name"],
            }
            bb = t.get("build_bonuses", {})
            # Save list format as-is; for dict format save only if non-empty
            if isinstance(bb, list):
                if bb:
                    entry["build_bonuses"] = bb
            elif bb.get("immediate") or bb.get("production"):
                entry["build_bonuses"] = bb
            ab = t.get("adjacency_bonuses", {})
            if ab:
                entry["adjacency_bonuses"] = ab
            reqs = t.get("requirements") or []
            if reqs:
                entry["requirements"] = reqs
            ob = t.get("only_build")
            if ob is not None:          # save even if [] (= no builds allowed)
                entry["only_build"] = ob
            out.append(entry)
        return out

    def load_config(self, config: list[dict]):
        lookup = {(c["row"], c["col"]): c for c in config}
        new_keys = set()
        for cfg in config:
            key = (cfg["row"], cfg["col"])
            if key not in self._tiles:
                self._tiles[key] = _make_tile(
                    cfg["row"], cfg["col"],
                    cfg.get("terrain", "empty"),
                    cfg.get("name", ""),
                    cfg.get("build_bonuses"),
                    cfg.get("adjacency_bonuses"),
                    cfg.get("requirements"),
                    cfg.get("only_build"),  # None means unrestricted
                )
                new_keys.add(key)
        for key, tile in self._tiles.items():
            if key in new_keys:
                continue
            saved = lookup.get(key)
            if saved:
                tile["terrain"] = saved.get("terrain", "empty")
                tile["name"] = saved.get("name", "")
                if "build_bonuses" in saved:
                    tile["build_bonuses"] = saved["build_bonuses"]
                if "adjacency_bonuses" in saved:
                    tile["adjacency_bonuses"] = saved["adjacency_bonuses"]
                tile["requirements"] = saved.get("requirements") or []
                tile["only_build"] = saved.get("only_build")  # None, [], or [...]

    def get_tile(self, row: int, col: int) -> dict | None:
        return self._tiles.get((row, col))

    def get_neighbors(self, row: int, col: int) -> list[dict]:
        dirs = _ODD_ROW_DIRS if row % 2 else _EVEN_ROW_DIRS
        return [
            self._tiles[k]
            for dr, dc in dirs
            if (k := (row + dr, col + dc)) in self._tiles
        ]

    def player_meets_requirements(self, row: int, col: int,
                                   played_card_types: set[str]) -> bool:
        """Return True if the player's played card types satisfy the tile's requirements."""
        t = self._tiles.get((row, col))
        if not t:
            return False
        reqs = t.get("requirements") or []
        return all(req in played_card_types for req in reqs)

    def can_stack(self, row: int, col: int, tile_type: str = "") -> bool:
        """Return True if tile_type can be stacked on top of a satellite at (row, col)."""
        t = self._tiles.get((row, col))
        if not t:
            return False
        pt = t.get("placed_tile")
        return (pt and pt["type"] == "satellite"
                and t.get("secondary_tile") is None
                and tile_type in _SATELLITE_STACKABLE)

    def can_place(self, row: int, col: int, tile_type: str = "") -> bool:
        t = self._tiles.get((row, col))
        if not t:
            return False
        # Stacking on a satellite is handled separately
        if t["placed_tile"] is not None:
            return False
        terrain = t["terrain"]
        if terrain in _NO_BUILD_TERRAINS:
            return False
        # space tiles → space terrain only
        if tile_type in _SPACE_TILES:
            allowed = _SPACE_TERRAIN_TILES.get(terrain, set())
            return tile_type in allowed
        # space terrains → space tiles only
        if terrain in _SPACE_TERRAIN_TILES:
            return tile_type in _SPACE_TERRAIN_TILES[terrain]
        # hydroelectric → lake only; lake → hydroelectric only
        if tile_type in _LAKE_ONLY:
            return terrain == "lake"
        if terrain == "lake":
            return False
        # rare_metal_mine tiles → its terrain only
        if tile_type in _MINE_ONLY:
            return terrain == "rare_metal_mine"
        if terrain == "rare_metal_mine":
            return False
        # launching_pad tiles → launching_pad terrain only; launching_pad terrain → launching_pad tiles only
        if tile_type == "launching_pad":
            return terrain == "launching_pad"
        if terrain == "launching_pad":
            return tile_type == "launching_pad"
        # offshore_wind → wind_power_plant only; offshore_solar → pv_power_plant only
        if terrain == "offshore_wind":
            return tile_type in _OFFSHORE_WIND_TILES
        if terrain == "offshore_solar":
            return tile_type in _OFFSHORE_SOLAR_TILES
        # sea → data_center only
        if terrain == "sea":
            return tile_type in _SEA_BUILDABLE
        # store, lobby_group, office → commercial only
        if tile_type in _COMMERCIAL_ONLY:
            return terrain == "commercial"
        if terrain == "commercial":
            return False
        # everything else → open terrains
        if terrain not in _OPEN_TERRAINS:
            return False
        # Per-tile only_build whitelist: None=all allowed, []=none, [...]= explicit list
        only_build = t.get("only_build")
        if only_build is not None and tile_type not in only_build:
            return False
        return True

    def left_right_slots(self, row: int, col: int) -> dict:
        """Check if the left (col-1) or right (col+1) slot is free."""
        result = {}
        for label, c in [("left", col - 1), ("right", col + 1)]:
            if (row, c) not in self._tiles:
                result[label] = {"row": row, "col": c}
        return result

    def set_placed_tile_editor(self, row: int, col: int, tile_type: str | None) -> bool:
        """Master-only: directly set or clear a placed_tile on a hex (editor use only)."""
        t = self._tiles.get((row, col))
        if not t:
            return False
        if tile_type:
            if tile_type not in TILE_TYPES:
                return False
            t["placed_tile"] = {"type": tile_type, "owner_id": None,
                                 "factory_refund": 0, "dc_production_bonus": 0}
        else:
            t["placed_tile"] = None
        return True

    def place_tile(self, row: int, col: int,
                   tile_type: str, owner_id: str,
                   factory_refund: int = 0,
                   dc_production_bonus: int = 0) -> dict:
        if not self.can_place(row, col, tile_type):
            return {}
        tile = self._tiles[(row, col)]
        tile_record = {
            "type": tile_type,
            "owner_id": owner_id,
            "factory_refund": factory_refund,
            "dc_production_bonus": dc_production_bonus,
        }
        tile["placed_tile"] = tile_record

        base = TILE_BASE_BONUSES.get(tile_type, {})
        immediate = dict(base.get("immediate", {}))
        production = dict(base.get("production", {}))

        # Build bonuses — conditional on what type of tile is placed here
        for entry in _normalize_build_bonuses(tile.get("build_bonuses", {})):
            bt = entry.get("build_type")
            if bt is None or bt == tile_type:
                for res, amt in (entry.get("immediate") or {}).items():
                    immediate[res] = immediate.get(res, 0) + amt
                for res, amt in (entry.get("production") or {}).items():
                    production[res] = production.get(res, 0) + amt

        # Adjacency bonuses from neighbours — conditional on what type is being placed
        for nb in self.get_neighbors(row, col):
            for entry in _normalize_adjacency_bonuses(nb.get("adjacency_bonuses", {})):
                bt = entry.get("build_type")
                if bt is None or bt == tile_type:
                    for res, amt in (entry.get("immediate") or {}).items():
                        immediate[res] = immediate.get(res, 0) + amt
                    for res, amt in (entry.get("production") or {}).items():
                        production[res] = production.get(res, 0) + amt

        # Power plant ↔ data center synergy (per-card bonus); all power plant variants qualify
        if tile_type in _POWER_PLANT_TYPES:
            for nb in self.get_neighbors(row, col):
                pt = nb.get("placed_tile")
                if pt and pt["type"] == "data_center":
                    production["data_centers"] = production.get("data_centers", 0) + dc_production_bonus
        elif tile_type == "data_center":
            for nb in self.get_neighbors(row, col):
                pt = nb.get("placed_tile")
                if pt and pt.get("type") in _POWER_PLANT_TYPES:
                    bonus = pt.get("dc_production_bonus", 1)
                    production["data_centers"] = production.get("data_centers", 0) + bonus

        return {"immediate": immediate, "production": production}

    def get_adjacent_factory_refund(self, row: int, col: int) -> int:
        """Sum factory_refund from all adjacent power plant tiles (all variants)."""
        total = 0
        for nb in self.get_neighbors(row, col):
            pt = nb.get("placed_tile")
            if pt and pt.get("type") in _POWER_PLANT_TYPES:
                total += pt.get("factory_refund", 0)
        return total

    def reset(self):
        for t in self._tiles.values():
            t["placed_tile"] = None

    def to_list(self) -> list[dict]:
        return list(self._tiles.values())
