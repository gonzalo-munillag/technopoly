from __future__ import annotations
from dataclasses import dataclass, field

# Sentinel: means "caller did not supply a value — keep whatever is stored"
_UNSET = object()

TILE_TYPES = {
    "nuclear_power_plant", "natural_gas_power_plant", "coal_power_plant",
    "pv_power_plant", "wind_power_plant", "geothermal_power_plant", "solar_thermal",
    "factory", "data_center", "store", "ad_campaign",
    "office", "lobby_group", "rare_metal_mine", "hydroelectric_power_plant",
    "satellite_solar", "satellite_dc", "launching_pad", "distribution_center",
}

TILE_BASE_BONUSES = {
    "nuclear_power_plant":       {},
    "natural_gas_power_plant":   {},
    "coal_power_plant":          {},
    "pv_power_plant":            {},
    "wind_power_plant":          {},
    "geothermal_power_plant":    {},
    "solar_thermal":             {},
    "factory":                   {},
    "data_center":               {},
    "store":                     {},
    "ad_campaign":               {},
    "office":                    {},
    "lobby_group":               {},
    "rare_metal_mine":           {},
    "hydroelectric_power_plant": {},
    "satellite_solar":           {},
    "satellite_dc":              {},
    "launching_pad":             {},
    "distribution_center":       {},
}

TILE_LABELS = {
    "nuclear_power_plant":       "☢️",
    "natural_gas_power_plant":   "🔥",
    "coal_power_plant":          "⛏️",
    "pv_power_plant":            "PV",
    "wind_power_plant":          "WND",
    "geothermal_power_plant":    "GEO",
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
    "distribution_center":       "📦",
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
    "empty", "city", "lake", "sea", "government", "commercial", "industrial",
    "sun", "wind", "gas_reserve", "coal", "wall", "rare_metal_mine",
    "natural_park", "offshore_wind", "offshore_solar", "space", "launching_pad",
    "mountain", "geothermal",
}

# Terrains where nothing can be built
_NO_BUILD_TERRAINS = {"government", "city", "wall", "mountain"}
# Terrains open to normal non-commercial, non-lake, non-offshore tiles
_OPEN_TERRAINS = {"empty", "sun", "wind", "gas_reserve", "coal", "natural_park", "geothermal", "industrial"}
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

def _matches_target_coords(entry: dict, row: int, col: int) -> bool:
    coords = entry.get("target_coords")
    if isinstance(coords, list) and coords:
        for it in coords:
            try:
                if isinstance(it, (list, tuple)) and len(it) >= 2:
                    if int(it[0]) == row and int(it[1]) == col:
                        return True
                elif isinstance(it, dict):
                    if int(it.get("row")) == row and int(it.get("col")) == col:
                        return True
            except Exception:
                continue
        return False
    tr = entry.get("target_row")
    tc = entry.get("target_col")
    if tr is None or tc is None:
        return True
    try:
        return int(tr) == row and int(tc) == col
    except Exception:
        return False

def _matches_build_type(entry: dict, tile_type: str) -> bool:
    bts = entry.get("build_types")
    if isinstance(bts, list) and bts:
        normalized = {
            _normalize_tile_type(x)
            for x in bts
            if _normalize_tile_type(x)
        }
        return tile_type in normalized
    bt = _normalize_tile_type(entry.get("build_type"))
    return bt is None or bt == tile_type

def _matches_terrain_type(entry: dict, terrain: str) -> bool:
    tts = entry.get("terrain_types")
    if isinstance(tts, list) and tts:
        return terrain in {str(x) for x in tts if x}
    tt = entry.get("terrain_type")
    return tt is None or tt == terrain

def _normalize_terrain_bonuses(tb) -> list:
    if isinstance(tb, list):
        return tb
    if isinstance(tb, dict) and tb:
        if "immediate" in tb or "production" in tb:
            return [{"terrain_type": None, "immediate": tb.get("immediate") or {},
                     "production": tb.get("production") or {}}]
        return [{"terrain_type": None, "immediate": dict(tb), "production": {}}]
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


def _normalize_tile_type(tile_type: str | None) -> str | None:
    """Backward compatibility: map retired tile keys to their replacements."""
    if isinstance(tile_type, str):
        tile_type = tile_type.strip().replace(" ", "_")
    if tile_type == "power_plant":
        return "nuclear_power_plant"  # default legacy fallback
    return tile_type


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
            pt = cfg.get("placed_tile")
            if isinstance(pt, dict) and pt.get("type"):
                pt["type"] = _normalize_tile_type(pt.get("type"))
            ob = cfg.get("only_build")
            if isinstance(ob, list):
                cfg["only_build"] = [_normalize_tile_type(x) for x in ob if _normalize_tile_type(x)]
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
                if isinstance(tile["only_build"], list):
                    tile["only_build"] = [_normalize_tile_type(x) for x in tile["only_build"] if _normalize_tile_type(x)]
            pt = tile.get("placed_tile")
            if isinstance(pt, dict) and pt.get("type"):
                pt["type"] = _normalize_tile_type(pt.get("type"))

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

    def can_place_for_player(
        self,
        row: int,
        col: int,
        tile_type: str,
        played_card_types: set[str] | None = None,
        only_playable_next_to: list[str] | None = None,
        only_playable_on_terrains: list[str] | None = None,
    ) -> bool:
        """Non-mutating placement feasibility check with player/card constraints."""
        tile_type = _normalize_tile_type(tile_type) or ""
        if not self.can_place(row, col, tile_type):
            return False
        if only_playable_on_terrains:
            t = self._tiles.get((row, col))
            if not t or t.get("terrain") not in set(only_playable_on_terrains):
                return False
        if played_card_types is not None and not self.player_meets_requirements(row, col, played_card_types):
            return False
        if only_playable_next_to:
            allowed = {
                _normalize_tile_type(t)
                for t in only_playable_next_to
                if _normalize_tile_type(t)
            }
            if allowed:
                has_match = False
                for nb in self.get_neighbors(row, col):
                    pt = nb.get("placed_tile")
                    if pt and _normalize_tile_type(pt.get("type")) in allowed:
                        has_match = True
                        break
                if not has_match:
                    return False
        return True

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
        tile_type = _normalize_tile_type(tile_type) or ""
        t = self._tiles.get((row, col))
        if not t:
            return False
        # Stacking on a satellite is handled separately
        if t["placed_tile"] is not None:
            return False
        # Placement is data-driven from board/tile editor config.
        # Terrain-specific hardcoded rules were removed.
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
            tile_type = _normalize_tile_type(tile_type)
            if tile_type not in TILE_TYPES:
                return False
            t["placed_tile"] = {
                "type": tile_type,
                "owner_id": None,
                "placed_tile_adjacency_bonuses": [],
            }
        else:
            t["placed_tile"] = None
        return True

    def place_tile(self, row: int, col: int,
                   tile_type: str, owner_id: str,
                   only_playable_next_to: list[str] | None = None,
                   only_playable_on_terrains: list[str] | None = None,
                   bonuses_by_placing_next_to_building: list[dict] | dict | None = None,
                   bonuses_by_building_on_terrain_type: list[dict] | dict | None = None,
                   bonuses_by_building_adjacent_to_terrain_type: list[dict] | dict | None = None,
                   placed_tile_adjacency_bonuses: list[dict] | dict | None = None) -> dict:
        tile_type = _normalize_tile_type(tile_type) or ""
        if not self.can_place(row, col, tile_type):
            return {}
        if only_playable_on_terrains:
            tile0 = self._tiles.get((row, col))
            if not tile0 or tile0.get("terrain") not in set(only_playable_on_terrains):
                return {}
        # Optional card-level adjacency restriction: this tile can only be placed
        # if at least one neighboring placed tile matches a required type.
        if only_playable_next_to:
            allowed = {
                _normalize_tile_type(t)
                for t in only_playable_next_to
                if _normalize_tile_type(t)
            }
            has_match = False
            if allowed:
                for nb in self.get_neighbors(row, col):
                    pt = nb.get("placed_tile")
                    if pt and _normalize_tile_type(pt.get("type")) in allowed:
                        has_match = True
                        break
            if not has_match:
                return {}
        tile = self._tiles[(row, col)]
        tile_record = {
            "type": tile_type,
            "owner_id": owner_id,
            "placed_tile_adjacency_bonuses": _normalize_adjacency_bonuses(placed_tile_adjacency_bonuses),
        }
        tile["placed_tile"] = tile_record

        base = TILE_BASE_BONUSES.get(tile_type, {})
        immediate = dict(base.get("immediate", {}))
        production = dict(base.get("production", {}))

        # Build bonuses — conditional on what type of tile is placed here
        for entry in _normalize_build_bonuses(tile.get("build_bonuses", {})):
            if _matches_build_type(entry, tile_type):
                for res, amt in (entry.get("immediate") or {}).items():
                    immediate[res] = immediate.get(res, 0) + amt
                for res, amt in (entry.get("production") or {}).items():
                    production[res] = production.get(res, 0) + amt

        # Adjacency bonuses from neighbours — fire once per unique neighbour terrain,
        # so being next to 2 sea tiles only counts the sea bonus once.
        seen_adj_terrains = set()
        seen_adj_placed = set()
        for nb in self.get_neighbors(row, col):
            nb_terrain = nb.get("terrain")
            if nb_terrain and nb_terrain not in seen_adj_terrains:
                seen_adj_terrains.add(nb_terrain)
                for entry in _normalize_adjacency_bonuses(nb.get("adjacency_bonuses", {})):
                    target_ok = _matches_target_coords(entry, row, col)
                    if _matches_build_type(entry, tile_type) and target_ok:
                        for res, amt in (entry.get("immediate") or {}).items():
                            immediate[res] = immediate.get(res, 0) + amt
                        for res, amt in (entry.get("production") or {}).items():
                            production[res] = production.get(res, 0) + amt
            pt = nb.get("placed_tile") or {}
            pt_type = _normalize_tile_type(pt.get("type"))
            if pt_type and pt_type not in seen_adj_placed:
                seen_adj_placed.add(pt_type)
                for entry in _normalize_adjacency_bonuses(pt.get("placed_tile_adjacency_bonuses", {})):
                    if _matches_build_type(entry, tile_type):
                        for res, amt in (entry.get("immediate") or {}).items():
                            immediate[res] = immediate.get(res, 0) + amt
                        for res, amt in (entry.get("production") or {}).items():
                            production[res] = production.get(res, 0) + amt

        # Card-level "bonuses by placing next to building":
        # Fires once per unique adjacent build type (not once per adjacent tile),
        # so being next to 2 factories still only grants the factory bonus once.
        if bonuses_by_placing_next_to_building:
            adjacent_build_types = {
                _normalize_tile_type(nb.get("placed_tile", {}).get("type"))
                for nb in self.get_neighbors(row, col)
                if nb.get("placed_tile")
            }
            adjacent_build_types.discard(None)
            for adj_type in adjacent_build_types:
                for entry in _normalize_adjacency_bonuses(bonuses_by_placing_next_to_building):
                    if _matches_build_type(entry, adj_type):
                        for res, amt in (entry.get("immediate") or {}).items():
                            immediate[res] = immediate.get(res, 0) + amt
                        for res, amt in (entry.get("production") or {}).items():
                            production[res] = production.get(res, 0) + amt

        # Card-level "bonuses by building on terrain type":
        # if this tile is placed on matching terrain, apply bonus.
        if bonuses_by_building_on_terrain_type:
            terrain = tile.get("terrain")
            for entry in _normalize_terrain_bonuses(bonuses_by_building_on_terrain_type):
                if _matches_terrain_type(entry, terrain):
                    for res, amt in (entry.get("immediate") or {}).items():
                        immediate[res] = immediate.get(res, 0) + amt
                    for res, amt in (entry.get("production") or {}).items():
                        production[res] = production.get(res, 0) + amt

        # Card-level "bonuses by building adjacent to terrain type":
        # Fires once per unique adjacent terrain type (not once per adjacent tile),
        # so being next to 2 commercial tiles still only grants the bonus once.
        if bonuses_by_building_adjacent_to_terrain_type:
            adjacent_terrains = {nb.get("terrain") for nb in self.get_neighbors(row, col) if nb.get("terrain")}
            for nb_terrain in adjacent_terrains:
                for entry in _normalize_terrain_bonuses(bonuses_by_building_adjacent_to_terrain_type):
                    if _matches_terrain_type(entry, nb_terrain):
                        for res, amt in (entry.get("immediate") or {}).items():
                            immediate[res] = immediate.get(res, 0) + amt
                        for res, amt in (entry.get("production") or {}).items():
                            production[res] = production.get(res, 0) + amt

        return {"immediate": immediate, "production": production}

    def reset(self):
        for t in self._tiles.values():
            t["placed_tile"] = None

    def to_list(self) -> list[dict]:
        return list(self._tiles.values())
