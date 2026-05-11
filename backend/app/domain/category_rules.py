"""Keyword-based category inference rules for product descriptions."""
import unicodedata

# Ordered list of (keyword, category_name) pairs.
# First match wins — more specific terms should come before general ones.
_CAT_KEYWORDS: list[tuple[str, str]] = [
    ("vodka",       "Vodka"),
    ("gin",         "Gin"),
    ("rum",         "Rum"),
    ("tequila",     "Tequila"),
    ("mezcal",      "Tequila"),
    ("whiskey",     "Whiskey"), ("whisky",   "Whiskey"),
    ("bourbon",     "Whiskey"), ("scotch",   "Whiskey"),
    ("pale ale",    "Beer"),    ("ipa",      "Beer"),
    ("lager",       "Beer"),    ("beer",     "Beer"),
    ("stout",       "Beer"),    ("ale",      "Beer"),
    ("sauvignon",   "White Wine"), ("chardonnay", "White Wine"),
    ("blanc",       "White Wine"), ("λευκο",     "White Wine"),
    ("rose",        "Rosé Wine"),  ("ροζε",      "Rosé Wine"),
    ("cabernet",    "Red Wine"),   ("merlot",    "Red Wine"),
    ("ερυθρ",       "Red Wine"),   ("rouge",     "Red Wine"),
    ("prosecco",    "Sparkling Wine"), ("champagne", "Sparkling Wine"),
    ("moscato",     "Sparkling Wine"), ("sparkling", "Sparkling Wine"),
    ("syrup",       "Syrups"),     ("sirop",     "Syrups"),
    ("puree",       "Fruit Purées"), ("purée",   "Fruit Purées"),
    ("liqueur",     "Liqueur"),    ("triple sec","Liqueur"),
    ("aperitivo",   "Aperitif"),   ("aperitif",  "Aperitif"),
    ("aperol",      "Aperitif"),   ("campari",   "Aperitif"),
    ("cachaça",     "Cachaça"),    ("cacha",     "Cachaça"),
    ("energy",      "Energy Drinks"), ("red bull", "Energy Drinks"),
    ("βουτυρο",     "Dairy & Cheese"), ("butter",   "Dairy & Cheese"),
    ("γαλα",        "Dairy & Cheese"), ("milk",     "Dairy & Cheese"),
    ("γιαουρτι",    "Dairy & Cheese"), ("yogurt",   "Dairy & Cheese"),
    ("τυρι",        "Dairy & Cheese"), ("cheese",   "Dairy & Cheese"),
    ("μοτσαρελα",   "Dairy & Cheese"), ("mozzarella","Dairy & Cheese"),
    ("σαντιγυ",     "Dairy & Cheese"), ("cream",    "Dairy & Cheese"),
    ("ελαιολαδο",   "Oils & Vinegars"), ("olive oil","Oils & Vinegars"),
    ("ξυδι",        "Oils & Vinegars"), ("vinegar",  "Oils & Vinegars"),
    ("balsamic",    "Oils & Vinegars"),
    ("μαρμελαδα",   "Condiments & Preserves"), ("jam",         "Condiments & Preserves"),
    ("τοματοπολτ",  "Condiments & Preserves"), ("tomato paste","Condiments & Preserves"),
    ("μανιταρ",     "Condiments & Preserves"), ("mushroom",    "Condiments & Preserves"),
    ("αντζουγια",   "Condiments & Preserves"), ("anchov",      "Condiments & Preserves"),
    ("κανελα",      "Spices & Herbs"),   ("cinnamon", "Spices & Herbs"),
    ("πιπερι",      "Spices & Herbs"),   ("pepper",   "Spices & Herbs"),
    ("lotus",       "Bakery & Confectionery"), ("biscuit", "Bakery & Confectionery"),
    ("cake",        "Bakery & Confectionery"), ("pastry",  "Bakery & Confectionery"),
    ("ζαχαρη",      "Sugar & Sweeteners"), ("sugar",  "Sugar & Sweeteners"),
    ("μελι",        "Sugar & Sweeteners"), ("honey",  "Sugar & Sweeteners"),
    ("coca cola",   "Soft Drinks"), ("fanta",    "Soft Drinks"),
    ("sprite",      "Soft Drinks"), ("schweppes","Soft Drinks"),
    ("soda",        "Soft Drinks"), ("αναψυκτ",  "Soft Drinks"),
    ("καφε",        "Coffee & Hot Beverages"), ("coffee",  "Coffee & Hot Beverages"),
    ("espresso",    "Coffee & Hot Beverages"), ("τσαι",    "Coffee & Hot Beverages"),
    ("tea",         "Coffee & Hot Beverages"),
    ("σπανακοπιτ",  "Savory Pies"),     ("τυροπιτ",   "Savory Pies"),
    ("μεμβρανη",    "Kitchen Supplies"), ("σακουλ",    "Kitchen Supplies"),
    ("wrap",        "Kitchen Supplies"),
]


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def infer_category_name(description: str) -> str | None:
    """Pure function: return the matching category name, or None."""
    normalized = _strip_accents(description)
    for kw, cat_name in _CAT_KEYWORDS:
        if _strip_accents(kw) in normalized:
            return cat_name
    return None


def infer_category_id(description: str, cur) -> int | None:
    """Resolve the inferred category name to its DB id, or None."""
    cat_name = infer_category_name(description)
    if not cat_name:
        return None
    row = cur.execute(
        "SELECT id FROM product_categories WHERE name = %s", (cat_name,)
    ).fetchone()
    return row["id"] if row else None
