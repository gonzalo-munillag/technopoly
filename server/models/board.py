from __future__ import annotations
from dataclasses import dataclass, field

TILE_TYPES = {
    "power_plant", "factory", "data_center", "store", "ad_campaign",
    "office", "lobby_group", "rare_metal_mine", "hydroelectric_power_plant",
    "satellite",
}

TILE_BASE_BONUSES = {
    "power_plant":               {},
    "factory":                   {},
    "data_center":               {"production": {"data_centers": 1}},
    "store":                     {"production": {"ad_campaigns": 1}},
    "ad_campaign":               {"production": {"ad_campaigns": 1}},
    "office":                    {"production": {"HR": 1}},
    "lobby_group":               {},
    "rare_metal_mine":           {"production": {"money": 10}},
    "hydroelectric_power_plant": {"production": {"data_centers": 2}},
    "satellite":                 {"production": {"data_centers": 2}},  # orbital DC
}

TILE_LABELS = {
    "power_plant":               "PWR",
    "factory":                   "FAC",
    "data_center":               "DC",
    "store":                     "STO",
    "ad_campaign":               "AD",
    "office":                    "OFC",
    "lobby_group":               "LOB",
    "rare_metal_mine":           "RMM",
    "hydroelectric_power_plant": "HYD",
    "satellite":                 "SAT",
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

_DEFAULT_ADJACENCY: dict = {}

# Default build bonuses applied automatically when a tile has this terrain.
_DEFAULT_BUILD_BONUSES: dict = {
    "natural_park":   {"immediate": {"reputation": -2}, "production": {}},
    "offshore_wind":  {"immediate": {"money": -100},    "production": {}},
    "offshore_solar": {"immediate": {"money": -100},    "production": {}},
    "sea":            {"immediate": {"money": -150},    "production": {}},
    "space":          {"immediate": {"money": -200},    "production": {}},
}

VALID_TERRAINS = {
    "empty", "city", "lake", "sea", "government", "commercial",
    "sun", "wind", "gas_reserve", "coal", "wall", "rare_metal_mine",
    "natural_park", "offshore_wind", "offshore_solar", "space",
}

# Terrains where nothing can be built
_NO_BUILD_TERRAINS = {"government", "city", "wall"}
# Terrains open to normal non-commercial, non-lake, non-offshore tiles
_OPEN_TERRAINS = {"empty", "sun", "wind", "gas_reserve", "coal", "natural_park"}
# Tiles restricted to commercial terrain only
_COMMERCIAL_ONLY = {"store", "lobby_group", "office"}
# Tiles restricted to rare_metal_mine terrain only
_MINE_ONLY = {"rare_metal_mine"}
# Tiles restricted to lake terrain only
_LAKE_ONLY = {"hydroelectric_power_plant"}
# Offshore terrains → power_plant only
_OFFSHORE_TERRAINS = {"offshore_wind", "offshore_solar"}
# Sea → data_center only
_SEA_BUILDABLE = {"data_center"}
# Space terrain → allowed tile types (satellite only; data_center/power_plant stack on satellite)
_SPACE_TERRAIN_TILES: dict[str, set] = {
    "space": {"satellite"},
}
_SPACE_TILES = {"satellite"}
# Tiles that can be stacked on top of a satellite secondary slot
_SATELLITE_STACKABLE = {"data_center", "power_plant"}


def _make_tile(row: int, col: int, terrain: str = "empty",
               name: str = "", build_bonuses: dict | None = None,
               adjacency_bonuses: dict | None = None,
               requirements: list | None = None,
               only_build: list | None = None) -> dict:
    adj = adjacency_bonuses
    if adj is None and terrain in _DEFAULT_ADJACENCY:
        adj = dict(_DEFAULT_ADJACENCY[terrain])
    bb = build_bonuses
    if bb is None and terrain in _DEFAULT_BUILD_BONUSES:
        bb = dict(_DEFAULT_BUILD_BONUSES[terrain])
    return {
        "row": row, "col": col,
        "terrain": terrain,
        "name": name,
        "placed_tile": None,
        "secondary_tile": None,  # tile built on top of a satellite
        "build_bonuses": bb or {"immediate": {}, "production": {}},
        "adjacency_bonuses": adj or {},
        "requirements": requirements or [],  # list of card types player must have played
        "only_build": only_build or [],      # list of tile types allowed to be built here
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
                         only_build: list | None = None) -> bool:
        t = self._tiles.get((row, col))
        if not t or terrain not in VALID_TERRAINS:
            return False
        t["terrain"] = terrain
        t["name"] = name
        t["placed_tile"] = None
        if build_bonuses is not None:
            t["build_bonuses"] = build_bonuses
        elif terrain in _DEFAULT_BUILD_BONUSES:
            t["build_bonuses"] = dict(_DEFAULT_BUILD_BONUSES[terrain])
        if adjacency_bonuses is not None:
            t["adjacency_bonuses"] = adjacency_bonuses
        elif terrain in _DEFAULT_ADJACENCY and not t.get("adjacency_bonuses"):
            t["adjacency_bonuses"] = dict(_DEFAULT_ADJACENCY[terrain])
        if requirements is not None:
            t["requirements"] = requirements
        if only_build is not None:
            t["only_build"] = only_build
        return True

    def set_terrain_type_properties(self, terrain: str,
                                    only_build: list | None = None,
                                    requirements: list | None = None) -> int:
        """Apply only_build and/or requirements to ALL tiles with the given terrain. Returns count updated."""
        count = 0
        for t in self._tiles.values():
            if t["terrain"] == terrain:
                if only_build is not None:
                    t["only_build"] = list(only_build)
                if requirements is not None:
                    t["requirements"] = list(requirements)
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
            if bb.get("immediate") or bb.get("production"):
                entry["build_bonuses"] = bb
            ab = t.get("adjacency_bonuses", {})
            if ab:
                entry["adjacency_bonuses"] = ab
            reqs = t.get("requirements") or []
            if reqs:
                entry["requirements"] = reqs
            ob = t.get("only_build") or []
            if ob:
                entry["only_build"] = ob
            if t.get("secondary_tile"):
                entry["secondary_tile"] = t["secondary_tile"]
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
                    cfg.get("only_build"),
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
                tile["only_build"] = saved.get("only_build") or []
                if "secondary_tile" in saved:
                    tile["secondary_tile"] = saved["secondary_tile"]

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
        # offshore terrains (wind/solar) → power_plant only
        if terrain in _OFFSHORE_TERRAINS:
            return tile_type == "power_plant"
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
        # Per-tile only_build whitelist (set in board editor) overrides open-terrain logic
        only_build = t.get("only_build") or []
        if only_build and tile_type not in only_build:
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
        stacking = self.can_stack(row, col, tile_type)
        if not stacking and not self.can_place(row, col, tile_type):
            return {}
        tile = self._tiles[(row, col)]
        tile_record = {
            "type": tile_type,
            "owner_id": owner_id,
            "factory_refund": factory_refund,
            "dc_production_bonus": dc_production_bonus,
        }
        if stacking:
            tile["secondary_tile"] = tile_record
        else:
            tile["placed_tile"] = tile_record

        base = TILE_BASE_BONUSES.get(tile_type, {})
        immediate = dict(base.get("immediate", {}))
        production = dict(base.get("production", {}))

        bb = tile.get("build_bonuses", {})
        for res, amt in bb.get("immediate", {}).items():
            immediate[res] = immediate.get(res, 0) + amt
        for res, amt in bb.get("production", {}).items():
            production[res] = production.get(res, 0) + amt

        for nb in self.get_neighbors(row, col):
            ab = nb.get("adjacency_bonuses", {})
            for res, amt in ab.items():
                immediate[res] = immediate.get(res, 0) + amt

        # Power plant ↔ data center synergy (per-card bonus)
        if tile_type == "power_plant":
            for nb in self.get_neighbors(row, col):
                pt = nb.get("placed_tile")
                if pt and pt["type"] == "data_center":
                    production["data_centers"] = production.get("data_centers", 0) + dc_production_bonus
        elif tile_type == "data_center":
            for nb in self.get_neighbors(row, col):
                pt = nb.get("placed_tile")
                if pt and pt["type"] == "power_plant":
                    bonus = pt.get("dc_production_bonus", 1)
                    production["data_centers"] = production.get("data_centers", 0) + bonus

        return {"immediate": immediate, "production": production}

    def get_adjacent_factory_refund(self, row: int, col: int) -> int:
        """Sum factory_refund from all adjacent power plants."""
        total = 0
        for nb in self.get_neighbors(row, col):
            pt = nb.get("placed_tile")
            if pt and pt["type"] == "power_plant":
                total += pt.get("factory_refund", 0)
        return total

    def reset(self):
        for t in self._tiles.values():
            t["placed_tile"] = None
            t["secondary_tile"] = None

    def to_list(self) -> list[dict]:
        return list(self._tiles.values())
