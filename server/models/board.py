from __future__ import annotations
from dataclasses import dataclass, field

TILE_TYPES = {"power_plant", "factory", "data_center", "store", "ad_campaign", "office", "lobby_group"}

TILE_BASE_BONUSES = {
    "power_plant":  {},
    "factory":      {},
    "data_center":  {"production": {"data_centers": 1}},
    "store":        {"production": {"ad_campaigns": 1}},
    "ad_campaign":  {"production": {"ad_campaigns": 1}},
    "office":       {"production": {"HR": 1}},
    "lobby_group":  {},
}

TILE_LABELS = {
    "power_plant":  "PWR",
    "factory":      "FAC",
    "data_center":  "DC",
    "store":        "STO",
    "ad_campaign":  "AD",
    "office":       "OFC",
    "lobby_group":  "LOB",
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

_DEFAULT_ADJACENCY = {
    "city":       {"users": 2, "suits": 1},
    "lake":       {"money": 1, "servers": 1},
    "government": {"reputation": 2},
}

VALID_TERRAINS = {"empty", "city", "lake", "government", "industrial", "commercial"}


def _make_tile(row: int, col: int, terrain: str = "empty",
               name: str = "", build_bonuses: dict | None = None,
               adjacency_bonuses: dict | None = None) -> dict:
    adj = adjacency_bonuses
    if adj is None and terrain in _DEFAULT_ADJACENCY:
        adj = dict(_DEFAULT_ADJACENCY[terrain])
    return {
        "row": row, "col": col,
        "terrain": terrain,
        "name": name,
        "placed_tile": None,
        "build_bonuses": build_bonuses or {"immediate": {}, "production": {}},
        "adjacency_bonuses": adj or {},
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
                         adjacency_bonuses: dict | None = None) -> bool:
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
        elif terrain in _DEFAULT_ADJACENCY and not t.get("adjacency_bonuses"):
            t["adjacency_bonuses"] = dict(_DEFAULT_ADJACENCY[terrain])
        return True

    MAX_ROWS = 10

    def add_tile(self, row: int, col: int) -> bool:
        if (row, col) in self._tiles:
            return False
        if row < 0 or row >= self.MAX_ROWS:
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

    def get_tile(self, row: int, col: int) -> dict | None:
        return self._tiles.get((row, col))

    def get_neighbors(self, row: int, col: int) -> list[dict]:
        dirs = _ODD_ROW_DIRS if row % 2 else _EVEN_ROW_DIRS
        return [
            self._tiles[k]
            for dr, dc in dirs
            if (k := (row + dr, col + dc)) in self._tiles
        ]

    TILE_ZONE_MAP = {
        "power_plant": "industrial", "factory": "industrial",
        "data_center": "industrial",
        "store": "commercial",
        "ad_campaign": "commercial", "lobby_group": "commercial",
        "office": "commercial",
    }

    def can_place(self, row: int, col: int, tile_type: str = "") -> bool:
        t = self._tiles.get((row, col))
        if not t or t["placed_tile"] is not None:
            return False
        terrain = t["terrain"]
        if terrain in ("lake", "government", "city"):
            return False
        if terrain == "empty":
            return True
        zone = self.TILE_ZONE_MAP.get(tile_type, "")
        return zone == terrain

    def left_right_slots(self, row: int, col: int) -> dict:
        """Check if the left (col-1) or right (col+1) slot is free."""
        result = {}
        for label, c in [("left", col - 1), ("right", col + 1)]:
            if (row, c) not in self._tiles:
                result[label] = {"row": row, "col": c}
        return result

    def place_tile(self, row: int, col: int,
                   tile_type: str, owner_id: str,
                   factory_refund: int = 0,
                   dc_production_bonus: int = 0) -> dict:
        if not self.can_place(row, col, tile_type):
            return {}
        tile = self._tiles[(row, col)]
        tile["placed_tile"] = {
            "type": tile_type,
            "owner_id": owner_id,
            "factory_refund": factory_refund,
            "dc_production_bonus": dc_production_bonus,
        }

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

    def to_list(self) -> list[dict]:
        return list(self._tiles.values())
