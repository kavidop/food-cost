"""Unit-of-measure normalization rules."""

# Maps raw invoice unit strings (including Greek abbreviations) to canonical
# abbreviations that match units_of_measure.abbreviation in the database.
_UNIT_ALIASES: dict[str, str] = {
    "κβτ": "kbt", "κιβ": "kbt", "box": "kbt",
    "τεμ": "pcs", "τμχ": "pcs", "τεμ.": "pcs",
    "κιλ": "kg",  "κγρ": "kg",
    "λιτ": "l",   "lit": "l",   "ltr": "l",
    "btl": "btl", "bot": "btl",
    "can": "can", "cs":  "cs",
}


def normalize_unit(unit_str: str) -> str:
    """Return the canonical unit abbreviation for a raw unit string."""
    key = unit_str.strip().lower()
    return _UNIT_ALIASES.get(key, key)


def build_unit_map(cur) -> dict[str, int]:
    """Build a {unit_string: unit_id} map covering both DB abbreviations and aliases."""
    cur.execute("SELECT id, abbreviation FROM units_of_measure")
    unit_map = {r["abbreviation"].lower(): r["id"] for r in cur.fetchall()}
    for alias, target in _UNIT_ALIASES.items():
        if alias not in unit_map and target in unit_map:
            unit_map[alias] = unit_map[target]
    return unit_map
