"""Rules for deciding whether two product names refer to the same product."""
import re
import unicodedata


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def names_similar(a: str, b: str, threshold: float = 0.5) -> bool:
    """Return True if product names share enough tokens to be considered the same item.

    Volume/weight qualifiers (e.g. 700ml, 1LT) are stripped before comparison so
    "Tanqueray Gin 700ml" and "TANQUERAY GIN 1LT" still match.
    """
    def tokens(s: str) -> set[str]:
        s = _strip_accents(s)
        s = re.sub(r"\b\d+(\.\d+)?\s*(ml|lt|kg|gr|g|l|cl)\b", "", s)
        return set(re.sub(r"[^a-z0-9 ]", " ", s).split())

    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return True
    overlap = len(ta & tb) / min(len(ta), len(tb))
    return overlap >= threshold
