# =============================================================================
# DEPRECATED — LEGACY APPLICATION
# =============================================================================
# This monolithic Flask app has been superseded by the refactored stack:
#
#   backend/   →  FastAPI + Pydantic + versioned SQL migrations
#   frontend/  →  React 18 + Vite + TypeScript
#
# Do NOT add features or fix bugs here.
# All future development happens in backend/ and frontend/.
# This directory is kept for reference only and will be removed in a future
# cleanup pass.
# =============================================================================

import os
import json
import base64
import sqlite3
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
import fitz          # PyMuPDF
import anthropic

load_dotenv(Path(__file__).parent / ".env")
from google import genai as google_genai
from google.genai import types as google_types

# ── Config ────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
DB_PATH  = BASE_DIR.parent / "zubro_food_cost.db"

app = Flask(__name__)

# Clients — initialised only when the API key is present
_anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
_google_key    = os.environ.get("GOOGLE_API_KEY", "")

anthropic_client = anthropic.Anthropic(api_key=_anthropic_key) if _anthropic_key else None
google_client    = google_genai.Client(api_key=_google_key)    if _google_key    else None

ANTHROPIC_MODELS = [
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6  (fast)"},
    {"id": "claude-opus-4-6",   "label": "Claude Opus 4.6    (best)"},
]
GEMINI_MODELS = [
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash  (fast)"},
    {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro    (best)"},
]


# ── DB bootstrap ──────────────────────────────────────────────────────────

def _ensure_tables():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS composite_products (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            category      TEXT,
            selling_price REAL,
            servings      INTEGER NOT NULL DEFAULT 1,
            notes         TEXT,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS composite_product_components (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            composite_product_id INTEGER NOT NULL
                                  REFERENCES composite_products(id) ON DELETE CASCADE,
            component_product_id INTEGER NOT NULL
                                  REFERENCES products(id),
            quantity             REAL    NOT NULL,
            unit                 TEXT
        );
    """)
    conn.commit()
    conn.close()

_ensure_tables()


# ── DB helper ─────────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ── Extraction prompt ─────────────────────────────────────────────────────

EXTRACT_PROMPT = """
You are an expert at reading supplier invoices (including Greek-language ones).
A single PDF may contain MULTIPLE separate invoices. Extract every invoice and
return ONLY this JSON — no markdown, no explanation:

{
  "invoices": [
    {
      "invoice_number": "string",
      "invoice_date":   "YYYY-MM-DD",
      "supplier": {
        "name":       "legal entity name",
        "trade_name": "trade/brand name or null",
        "vat_number": "tax/VAT registration number or null",
        "phone":      "phone or null",
        "address":    "full address or null"
      },
      "net_amount":         number,
      "vat_amount":         number,
      "excise_duty_amount": number,
      "gross_amount":       number,
      "line_items": [
        {
          "supplier_sku":         "product code printed on invoice or null",
          "description":          "full product name as printed",
          "quantity":             number,
          "unit":                 "btl|can|kg|L|pcs|kbt",
          "unit_price":           number,
          "discount_percent":     number,
          "line_net_amount":      number,
          "vat_rate":             number,
          "excise_duty_per_unit": number,
          "line_gross_amount":    number
        }
      ]
    }
  ]
}

Rules:
- INVOICE BOUNDARIES: First, identify which field on the document represents the invoice /
  document number. Different suppliers label it differently — common labels include:
  "ΑΡΙΘΜΟΣ", "ΑΡ. ΠΑΡΑΣΤΑΤΙΚΟΥ", "ΤΙΜΟΛΟΓΙΟ", "ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ", "INVOICE NO",
  "INVOICE #", "INVOICE NUMBER", or any prominent number near the document header.
  Once identified, each distinct value of that field = one separate invoice.
  Multiple consecutive pages that share the same document number belong to the same
  invoice — merge their line items into one entry.
  Do NOT concatenate or join multiple document numbers into a single invoice_number string.
- Always return the "invoices" array even if only one invoice is found
- Dates → ISO-8601 (YYYY-MM-DD)
- All monetary values → plain numbers, no currency symbols
- excise_duty_per_unit: Ε.Φ.Κ. / special excise duty per unit; 0 if none
- unit: "btl" bottles/vials, "can" cans, "kg" weight, "L" litre containers, "kbt" boxes/crates (ΚΒΤ/ΚΙΒΩΤΙΟ), "pcs" other individual pieces
- Include ALL lines including pallet charges or delivery fees
- Unknown string fields → null; unknown numeric fields → 0
""".strip()


# ── Category inference from product description ───────────────────────────

_CAT_KEYWORDS = [
    ("vodka",      "Vodka"),
    ("gin",        "Gin"),
    ("rum",        "Rum"),
    ("tequila",    "Tequila"), ("mezcal",    "Tequila"),
    ("whiskey",    "Whiskey"), ("whisky",    "Whiskey"),
    ("bourbon",    "Whiskey"), ("scotch",    "Whiskey"),
    ("pale ale",   "Beer"),    ("ipa",       "Beer"),
    ("lager",      "Beer"),    ("beer",      "Beer"),
    ("stout",      "Beer"),    ("ale",       "Beer"),
    ("sauvignon",  "White Wine"), ("chardonnay","White Wine"),
    ("blanc",      "White Wine"), ("λευκο",    "White Wine"),
    ("rose",       "Rosé Wine"),  ("ροζε",     "Rosé Wine"),
    ("cabernet",   "Red Wine"),   ("merlot",   "Red Wine"),
    ("ερυθρ",      "Red Wine"),   ("rouge",    "Red Wine"),
    ("prosecco",   "Sparkling Wine"), ("champagne","Sparkling Wine"),
    ("moscato",    "Sparkling Wine"), ("sparkling","Sparkling Wine"),
    ("syrup",      "Syrups"),    ("sirop",    "Syrups"),
    ("puree",      "Fruit Purées"), ("purée",  "Fruit Purées"),
    ("liqueur",    "Liqueur"),   ("triple sec","Liqueur"),
    ("aperitivo",  "Aperitif"),  ("aperitif", "Aperitif"),
    ("aperol",     "Aperitif"),  ("campari",  "Aperitif"),
    ("cachaça",    "Cachaça"),   ("cacha",    "Cachaça"),
    ("energy",     "Energy Drinks"), ("red bull","Energy Drinks"),
    # Food — Dairy & Cheese
    ("βουτυρο",    "Dairy & Cheese"), ("butter",     "Dairy & Cheese"),
    ("γαλα",       "Dairy & Cheese"), ("milk",       "Dairy & Cheese"),
    ("γιαουρτι",   "Dairy & Cheese"), ("yogurt",     "Dairy & Cheese"),
    ("τυρι",       "Dairy & Cheese"), ("cheese",     "Dairy & Cheese"),
    ("μοτσαρελα",  "Dairy & Cheese"), ("mozzarella", "Dairy & Cheese"),
    ("κοτατζ",     "Dairy & Cheese"), ("cottage",    "Dairy & Cheese"),
    ("πεκορινο",   "Dairy & Cheese"), ("pecorino",   "Dairy & Cheese"),
    # Food — Oils & Vinegars
    ("ελαιολαδο",  "Oils & Vinegars"), ("olive oil",  "Oils & Vinegars"),
    ("ηλιελαιο",   "Oils & Vinegars"), ("sunflower oil","Oils & Vinegars"),
    ("ξυδι",       "Oils & Vinegars"), ("vinegar",    "Oils & Vinegars"),
    ("balsamic",   "Oils & Vinegars"), ("truffle oil","Oils & Vinegars"),
    # Food — Condiments & Preserves
    ("καπαρη",     "Condiments & Preserves"), ("caper",    "Condiments & Preserves"),
    ("μαρμελαδα",  "Condiments & Preserves"), ("jam",      "Condiments & Preserves"),
    ("τοματοπολτ", "Condiments & Preserves"), ("tomato paste","Condiments & Preserves"),
    ("ταρτουφατα", "Condiments & Preserves"), ("tartufata","Condiments & Preserves"),
    ("μανιταρ",    "Condiments & Preserves"), ("mushroom", "Condiments & Preserves"),
    ("αντζουγια",  "Condiments & Preserves"), ("anchov",   "Condiments & Preserves"),
    ("τουρσι",     "Condiments & Preserves"), ("pickle",   "Condiments & Preserves"),
    # Food — Spices & Herbs
    ("κανελα",     "Spices & Herbs"), ("cinnamon",   "Spices & Herbs"),
    ("κυμινο",     "Spices & Herbs"), ("cumin",      "Spices & Herbs"),
    ("πιπερι",     "Spices & Herbs"), ("pepper",     "Spices & Herbs"),
    ("smoke aroma","Spices & Herbs"),
    # Food — Bakery & Confectionery
    ("τσουρεκ",    "Bakery & Confectionery"), ("μπισκοτ", "Bakery & Confectionery"),
    ("lotus",      "Bakery & Confectionery"), ("biscuit", "Bakery & Confectionery"),
    # Food — Dried Fruits & Grains
    ("αποξηρ",     "Dried Fruits & Grains"), ("dried fruit","Dried Fruits & Grains"),
    ("πλιγουρι",   "Dried Fruits & Grains"), ("bulgur",   "Dried Fruits & Grains"),
    # Food — Specialty Ingredients
    ("ασκορβικ",   "Specialty Ingredients"), ("ascorbic", "Specialty Ingredients"),
    ("ξανθαν",     "Specialty Ingredients"), ("xanthan",  "Specialty Ingredients"),
    ("λιποδιαλ",   "Specialty Ingredients"),
    # Food — Deli & Charcuterie
    ("γαλοπουλα",  "Deli & Charcuterie"), ("turkey",    "Deli & Charcuterie"),
    ("prosciutto", "Deli & Charcuterie"), ("salami",    "Deli & Charcuterie"),
    # Food — Kitchen Supplies
    ("μεμβρανη",   "Kitchen Supplies"), ("σακουλ",    "Kitchen Supplies"),
    ("wrap",       "Kitchen Supplies"), ("piping bag", "Kitchen Supplies"),
    # Food — Savory Pies
    ("σπανακοπιτ", "Savory Pies"), ("τυροπιτ",   "Savory Pies"),
    ("κιμαδοπιτ",  "Savory Pies"), ("κασεροπιτ", "Savory Pies"),
    ("πατατοπιτ",  "Savory Pies"), ("χορτοπιτ",  "Savory Pies"),
    ("κρεατοπιτ",  "Savory Pies"), ("spanakopita","Savory Pies"),
    # Food — Bakery & Confectionery (extra pastry/dessert terms)
    ("λεμονοπιτ",  "Bakery & Confectionery"), ("γαλατοπιτ", "Bakery & Confectionery"),
    ("ταρτα",      "Bakery & Confectionery"), ("tarte",     "Bakery & Confectionery"),
    ("cake",       "Bakery & Confectionery"), ("pastry",    "Bakery & Confectionery"),
    # Food — Sugar & Sweeteners
    ("ζαχαρη",     "Sugar & Sweeteners"), ("sugar",      "Sugar & Sweeteners"),
    ("ζαχαρι",     "Sugar & Sweeteners"), ("μελι",       "Sugar & Sweeteners"),
    ("σιροπι",     "Sugar & Sweeteners"), ("honey",      "Sugar & Sweeteners"),
    # Beverages — Soft Drinks
    ("coca cola",  "Soft Drinks"), ("fanta",     "Soft Drinks"),
    ("sprite",     "Soft Drinks"), ("schweppes", "Soft Drinks"),
    ("perrier",    "Soft Drinks"), ("soda",      "Soft Drinks"),
    ("αναψυκτ",    "Soft Drinks"), ("7up",       "Soft Drinks"),
    ("pepsi",      "Soft Drinks"), ("αμιτα",     "Soft Drinks"),
    # Beverages — Bar Supplies
    ("κενη φιαλη", "Bar Supplies"), ("κενο βαρελ","Bar Supplies"),
    ("φιαλη co2",  "Bar Supplies"), ("κιβωτιο πλ","Bar Supplies"),
    # Beverages — Coffee & Hot Beverages
    ("καφε",       "Coffee & Hot Beverages"), ("coffee",    "Coffee & Hot Beverages"),
    ("nescafe",    "Coffee & Hot Beverages"), ("espresso",  "Coffee & Hot Beverages"),
    ("cappuccino", "Coffee & Hot Beverages"), ("τσαι",      "Coffee & Hot Beverages"),
    ("tea",        "Coffee & Hot Beverages"), ("cocoa",     "Coffee & Hot Beverages"),
    # Food — Dairy & Cheese (extra terms for mixed-case / accented names)
    ("σαντιγυ",    "Dairy & Cheese"), ("cream",      "Dairy & Cheese"),
    ("whipped",    "Dairy & Cheese"), ("evapore",    "Dairy & Cheese"),
    ("εβαπορε",    "Dairy & Cheese"), ("baristas",   "Dairy & Cheese"),
    ("alpro",      "Dairy & Cheese"),
]

import unicodedata as _ud

def _strip_accents(s: str) -> str:
    """Lowercase and remove Greek/Latin diacritics so 'Γάλα' matches keyword 'γαλα'."""
    return "".join(
        c for c in _ud.normalize("NFD", s.lower())
        if _ud.category(c) != "Mn"
    )

def _infer_category_id(description: str, cur) -> int | None:
    normalized = _strip_accents(description)
    for kw, cat_name in _CAT_KEYWORDS:
        if _strip_accents(kw) in normalized:
            cur.execute("SELECT id FROM product_categories WHERE name = ?", (cat_name,))
            row = cur.fetchone()
            if row:
                return row["id"]
    return None


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/providers")
def get_providers():
    """Tell the UI which providers are configured and their available models."""
    return jsonify({
        "anthropic": {
            "available": bool(_anthropic_key),
            "models":    ANTHROPIC_MODELS,
        },
        "gemini": {
            "available": bool(_google_key),
            "models":    GEMINI_MODELS,
        },
    })


# ── Extraction helpers ────────────────────────────────────────────────────

import re

DEBUG_PATH = BASE_DIR / "last_raw_response.txt"


class ExtractionError(Exception):
    """Carries the raw model text so the caller can log it."""
    def __init__(self, msg: str, raw: str = ""):
        super().__init__(msg)
        self.raw = raw


def _save_debug(raw: str, note: str = "") -> None:
    try:
        DEBUG_PATH.write_text(
            (note + "\n\n" if note else "") + "---RAW RESPONSE---\n" + raw,
            encoding="utf-8",
        )
    except Exception:
        pass


def _extract_json_object(raw: str) -> str:
    """Pull out the outermost {...} block; discard any prose around it."""
    start = raw.find("{")
    if start == -1:
        raise ExtractionError("No JSON object found in model response", raw)

    depth = in_string = escape = False
    depth = 0

    for i, ch in enumerate(raw[start:], start):
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start : i + 1]

    raise ExtractionError(
        "Incomplete JSON — response was cut off before the closing brace", raw
    )


def _repair_json(raw: str) -> str:
    raw = re.sub(r",\s*([}\]])", r"\1", raw)   # trailing commas
    return raw


def _parse_json(raw: str) -> dict:
    extracted = _extract_json_object(raw)       # raises ExtractionError with raw attached
    repaired  = _repair_json(extracted)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        raise ExtractionError(f"JSON decode error: {e}", raw) from e


def _extract_anthropic(pdf_path: str, model: str) -> dict:
    if not anthropic_client:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    doc   = fitz.open(pdf_path)
    parts = []
    for i, page in enumerate(doc):
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
        parts.append({"type": "text",  "text": f"--- Page {i + 1} of {len(doc)} ---"})
        parts.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/png", "data": b64
        }})
    doc.close()
    parts.append({"type": "text", "text": EXTRACT_PROMPT})

    response = anthropic_client.messages.create(
        model      = model,
        max_tokens = 16000,
        messages   = [{"role": "user", "content": parts}],
    )
    raw = response.content[0].text
    if response.stop_reason == "max_tokens":
        _save_debug(raw, "TRUNCATED — hit max_tokens limit")
        raise ExtractionError(
            "Response was cut off (max_tokens). Try a shorter invoice or the Opus model.", raw
        )
    return _parse_json(raw)


def _extract_gemini(pdf_path: str, model: str) -> dict:
    if not google_client:
        raise RuntimeError("GOOGLE_API_KEY is not set.")

    # Upload the raw PDF — Gemini handles text PDFs and scanned images natively
    with open(pdf_path, "rb") as fh:
        uploaded = google_client.files.upload(
            file   = fh,
            config = google_types.UploadFileConfig(mime_type="application/pdf"),
        )

    try:
        response = google_client.models.generate_content(
            model    = model,
            contents = [uploaded, EXTRACT_PROMPT],
        )
    finally:
        # Clean up the uploaded file from Google's servers
        try:
            google_client.files.delete(name=uploaded.name)
        except Exception:
            pass

    raw = response.text
    return _parse_json(raw)


# ── /api/extract ──────────────────────────────────────────────────────────

@app.post("/api/extract")
def extract():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are accepted"}), 400

    provider = request.form.get("provider", "anthropic").lower()
    model    = request.form.get("model", "claude-sonnet-4-6")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        if provider == "gemini":
            data = _extract_gemini(tmp_path, model)
        else:
            data = _extract_anthropic(tmp_path, model)

        # Normalise: old single-invoice format → new array format
        if "invoices" not in data and "invoice_number" in data:
            data = {"invoices": [data]}
        return jsonify({"success": True, "invoices": data.get("invoices", []),
                        "provider": provider, "model": model})

    except ExtractionError as e:
        _save_debug(e.raw, str(e))
        return jsonify({
            "error": str(e),
            "hint":  f"Full model output saved to {DEBUG_PATH}",
        }), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


# ── Invoice import ────────────────────────────────────────────────────────

def _names_similar(a: str, b: str, threshold: float = 0.5) -> bool:
    """True if the two product names share enough tokens after normalization."""
    def tokens(s):
        s = _strip_accents(s)
        s = re.sub(r'\b\d+(\.\d+)?\s*(ml|lt|kg|gr|g|l|cl)\b', '', s)
        return set(re.sub(r'[^a-z0-9 ]', ' ', s).split())
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return True
    overlap = len(ta & tb) / min(len(ta), len(tb))
    return overlap >= threshold


def _import_one(cur, data: dict, unit_map: dict) -> tuple[int, list]:
    """Import a single invoice dict; returns (invoice_id, warnings)."""
    warnings: list[dict] = []
    s   = data["supplier"]
    vat = (s.get("vat_number") or "").strip()
    if not vat:
        vat = "NOVAT_" + (s.get("name") or "unknown").replace(" ", "_")[:20]
    s["vat_number"] = vat

    cur.execute("""
        INSERT INTO suppliers (name, trade_name, vat_number, phone, address)
        VALUES (:name, :trade_name, :vat_number, :phone, :address)
        ON CONFLICT(vat_number) DO UPDATE SET
            name       = excluded.name,
            trade_name = excluded.trade_name,
            phone      = excluded.phone,
            address    = excluded.address
    """, s)
    cur.execute("SELECT id FROM suppliers WHERE vat_number = ?", (vat,))
    supplier_id = cur.fetchone()["id"]

    cur.execute("""
        INSERT INTO invoices
            (supplier_id, invoice_number, invoice_date,
             net_amount, vat_amount, excise_duty_amount, gross_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (supplier_id, data["invoice_number"], data["invoice_date"],
          data["net_amount"], data["vat_amount"],
          data["excise_duty_amount"], data["gross_amount"]))
    invoice_id = cur.lastrowid

    for item in data.get("line_items", []):
        sp_id = None
        sku   = (item.get("supplier_sku") or "").strip() or None
        qty   = item.get("quantity") or 0

        desc = (item.get("description") or "").strip()
        if sku:
            cur.execute("""
                SELECT sp.id, p.name
                FROM supplier_products sp
                JOIN products p ON p.id = sp.product_id
                WHERE sp.supplier_id = ? AND sp.supplier_sku = ?
            """, (supplier_id, sku))
            row = cur.fetchone()
            if row:
                sp_id        = row["id"]
                existing_name = row["name"]
                cur.execute("""
                    UPDATE supplier_products
                    SET current_price          = ?,
                        total_quantity_ordered = COALESCE(total_quantity_ordered, 0) + ?,
                        updated_at             = datetime('now')
                    WHERE id = ?
                """, (item["unit_price"], qty, sp_id))
                if not _names_similar(existing_name, desc):
                    warnings.append({
                        "sku":           sku,
                        "existing_name": existing_name,
                        "invoice_name":  desc,
                        "message": (
                            f"SKU {sku}: invoice says \"{desc}\" "
                            f"but existing product is \"{existing_name}\""
                        ),
                    })
            else:
                cat_id              = _infer_category_id(desc, cur)
                unit_id_for_product = unit_map.get((item.get("unit") or "").lower(), None)
                units_per_pack      = item.get("units_per_pack") or None
                cur.execute(
                    "INSERT INTO products (name, description, category_id, unit_id, units_per_pack) VALUES (?, ?, ?, ?, ?)",
                    (desc, desc, cat_id, unit_id_for_product, units_per_pack)
                )
                product_id = cur.lastrowid
                cur.execute("""
                    INSERT INTO supplier_products
                        (supplier_id, product_id, supplier_sku,
                         supplier_product_name, current_price,
                         total_quantity_ordered, is_preferred_supplier)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                """, (supplier_id, product_id, sku,
                      desc, item["unit_price"], qty))
                sp_id = cur.lastrowid
        elif desc:
            # No SKU — match by supplier + exact product name, or create new
            cur.execute("""
                SELECT sp.id FROM supplier_products sp
                JOIN products p ON p.id = sp.product_id
                WHERE sp.supplier_id = ? AND sp.supplier_sku IS NULL
                  AND LOWER(p.name) = LOWER(?)
                LIMIT 1
            """, (supplier_id, desc))
            row = cur.fetchone()
            if row:
                sp_id = row["id"]
                cur.execute("""
                    UPDATE supplier_products
                    SET current_price          = ?,
                        total_quantity_ordered = COALESCE(total_quantity_ordered, 0) + ?,
                        updated_at             = datetime('now')
                    WHERE id = ?
                """, (item["unit_price"], qty, sp_id))
            else:
                cat_id              = _infer_category_id(desc, cur)
                unit_id_for_product = unit_map.get((item.get("unit") or "").lower(), None)
                units_per_pack      = item.get("units_per_pack") or None
                cur.execute(
                    "INSERT INTO products (name, description, category_id, unit_id, units_per_pack) VALUES (?, ?, ?, ?, ?)",
                    (desc, desc, cat_id, unit_id_for_product, units_per_pack)
                )
                product_id = cur.lastrowid
                cur.execute("""
                    INSERT INTO supplier_products
                        (supplier_id, product_id, supplier_sku,
                         supplier_product_name, current_price,
                         total_quantity_ordered, is_preferred_supplier)
                    VALUES (?, ?, NULL, ?, ?, ?, 1)
                """, (supplier_id, product_id,
                      desc, item["unit_price"], qty))
                sp_id = cur.lastrowid

        unit_id = unit_map.get((item.get("unit") or "btl").lower(), 1)
        cur.execute("""
            INSERT INTO invoice_lines
                (invoice_id, supplier_product_id, line_description,
                 quantity, unit_id, unit_price, discount_percent,
                 line_net_amount, vat_rate, excise_duty_per_unit, line_gross_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (invoice_id, sp_id, item["description"],
              qty, unit_id, item["unit_price"],
              item.get("discount_percent") or 0,
              item["line_net_amount"], item["vat_rate"],
              item.get("excise_duty_per_unit") or 0,
              item["line_gross_amount"]))

        if sp_id:
            cur.execute("""
                INSERT INTO price_history
                    (supplier_product_id, unit_price, vat_rate,
                     excise_duty_per_unit, effective_from, invoice_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (sp_id, item["unit_price"], item["vat_rate"],
                  item.get("excise_duty_per_unit") or 0,
                  data["invoice_date"], invoice_id))
    return invoice_id, warnings


@app.post("/api/import-invoice")
def import_invoice():
    body = request.get_json(force=True)
    # Accept {"invoices":[...]} (new) or a bare single invoice (legacy)
    invoices = body.get("invoices") if "invoices" in body else [body]

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id, abbreviation FROM units_of_measure")
        _rows = cur.fetchall()
        # case-insensitive map: abbreviation → id
        unit_map = {r["abbreviation"].lower(): r["id"] for r in _rows}
        # Greek / common aliases that suppliers print on invoices
        _UNIT_ALIASES = {
            "κβτ":  "kbt",  # κιβώτιο = box
            "κιβ":  "kbt",
            "box":  "kbt",
            "τεμ":  "pcs",  # τεμάχιο = piece
            "τμχ":  "pcs",
            "τεμ.": "pcs",
            "pcs":  "pcs",
            "κιλ":  "kg",   # κιλό
            "κγρ":  "kg",
            "λιτ":  "l",    # λίτρο
            "lit":  "l",
            "ltr":  "l",
            "btl":  "btl",
            "bot":  "btl",
            "can":  "can",
            "cs":   "cs",
        }
        for alias, target in _UNIT_ALIASES.items():
            if alias not in unit_map and target in unit_map:
                unit_map[alias] = unit_map[target]

        all_warnings: list[dict] = []
        ids: list[int] = []
        for inv in invoices:
            inv_id, warns = _import_one(cur, inv, unit_map)
            ids.append(inv_id)
            all_warnings.extend(warns)
        conn.commit()
        return jsonify({"success": True, "invoice_ids": ids, "warnings": all_warnings})

    except sqlite3.IntegrityError as e:
        conn.rollback()
        return jsonify({"error": f"Duplicate invoice or constraint violation: {e}"}), 409
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ── Products ──────────────────────────────────────────────────────────────

_SORT_COLS = {
    "name":     "p.name",
    "sku":      "sp.supplier_sku",
    "category": "pc.name",
    "price":    "sp.current_price",
}

@app.get("/api/products/all")
def all_products_for_picker():
    """Lightweight list used by BOM / recipe pickers — no pagination."""
    conn = get_db()
    cur  = conn.cursor()
    rows = cur.execute("""
        SELECT p.id, p.name,
               COALESCE(p.units_per_pack, 1)   AS units_per_pack,
               uom.abbreviation                AS unit,
               COALESCE(
                   (SELECT MIN(sp.current_price)
                    FROM supplier_products sp
                    WHERE sp.product_id = p.id AND sp.current_price IS NOT NULL), 0
               ) AS current_price
        FROM products p
        LEFT JOIN units_of_measure uom ON uom.id = p.unit_id
        ORDER BY p.name
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/api/products/search")
def search_products():
    q           = request.args.get("q", "").strip()
    category_id = request.args.get("category_id", "")
    supplier_id = request.args.get("supplier_id", "")
    page        = max(1, int(request.args.get("page", 1)))
    sort_by     = request.args.get("sort_by", "name")
    sort_dir    = "DESC" if request.args.get("sort_dir", "asc").lower() == "desc" else "ASC"
    per_page    = 25
    offset      = (page - 1) * per_page

    order_col = _SORT_COLS.get(sort_by, "p.name")

    where  = ["1=1"]
    params = []

    if q:
        where.append("(p.name LIKE ? OR p.description LIKE ? OR sp.supplier_sku LIKE ?)")
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    if category_id:
        where.append("p.category_id = ?")
        params.append(category_id)
    if supplier_id:
        where.append("sp.supplier_id = ?")
        params.append(supplier_id)

    sql_where = " AND ".join(where)
    conn = get_db()
    cur  = conn.cursor()

    cur.execute(f"""
        SELECT COUNT(DISTINCT p.id)
        FROM products p
        LEFT JOIN supplier_products sp ON sp.product_id = p.id
        WHERE {sql_where}
    """, params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT p.id, p.name, p.description, p.volume_ml, p.abv_percent,
               p.units_per_pack, p.pack_unit_size_ml, p.pack_unit_id,
               pc.name                AS category,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier,
               sp.id                  AS supplier_product_id,
               sp.supplier_sku,
               sp.current_price,
               sp.total_quantity_ordered,
               uom.abbreviation       AS unit,
               puom.abbreviation      AS pack_unit
        FROM products p
        LEFT JOIN supplier_products sp  ON sp.product_id  = p.id
        LEFT JOIN suppliers s           ON s.id            = sp.supplier_id
        LEFT JOIN product_categories pc ON pc.id           = p.category_id
        LEFT JOIN units_of_measure uom  ON uom.id          = p.unit_id
        LEFT JOIN units_of_measure puom ON puom.id         = p.pack_unit_id
        WHERE {sql_where}
        GROUP BY p.id
        ORDER BY {order_col} {sort_dir} NULLS LAST
        LIMIT ? OFFSET ?
    """, params + [per_page, offset])
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({
        "products": rows, "total": total, "page": page,
        "per_page": per_page, "sort_by": sort_by, "sort_dir": sort_dir.lower(),
    })


@app.get("/api/categories")
def get_categories():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT id, name, parent_id FROM product_categories ORDER BY name")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.post("/api/categories")
def create_category():
    data      = request.get_json()
    name      = (data.get("name") or "").strip()
    parent_id = data.get("parent_id") or None
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("INSERT INTO product_categories (name, parent_id) VALUES (?, ?)", (name, parent_id))
    conn.commit()
    cat_id = cur.lastrowid
    conn.close()
    return jsonify({"id": cat_id, "name": name, "parent_id": parent_id}), 201


@app.put("/api/categories/<int:cat_id>")
def update_category(cat_id):
    data      = request.get_json()
    name      = (data.get("name") or "").strip()
    parent_id = data.get("parent_id") or None
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if parent_id == cat_id:
        return jsonify({"error": "A category cannot be its own parent"}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("UPDATE product_categories SET name=?, parent_id=? WHERE id=?", (name, parent_id, cat_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.delete("/api/categories/<int:cat_id>")
def delete_category(cat_id):
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM products WHERE category_id=?", (cat_id,))
    prod_cnt = cur.fetchone()[0]
    if prod_cnt:
        conn.close()
        return jsonify({"error": f"Cannot delete: {prod_cnt} product(s) are assigned to this category"}), 409
    cur.execute("SELECT COUNT(*) FROM product_categories WHERE parent_id=?", (cat_id,))
    sub_cnt = cur.fetchone()[0]
    if sub_cnt:
        conn.close()
        return jsonify({"error": f"Cannot delete: {sub_cnt} sub-categor{'ies' if sub_cnt>1 else 'y'} exist under this category"}), 409
    cur.execute("DELETE FROM product_categories WHERE id=?", (cat_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/suppliers")
def get_suppliers():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT s.id, s.name, s.trade_name, s.vat_number, s.phone, s.email, s.is_active,
               (SELECT COUNT(*)              FROM invoices WHERE supplier_id = s.id)           AS invoice_count,
               (SELECT COALESCE(SUM(gross_amount),0) FROM invoices WHERE supplier_id = s.id)  AS total_spend,
               (SELECT COUNT(DISTINCT product_id)    FROM supplier_products WHERE supplier_id = s.id) AS product_count,
               (
                   SELECT pc.name
                   FROM supplier_products sp2
                   JOIN products p2          ON p2.id  = sp2.product_id
                   JOIN product_categories pc ON pc.id = p2.category_id
                   WHERE sp2.supplier_id = s.id AND p2.category_id IS NOT NULL
                   GROUP BY p2.category_id
                   ORDER BY COUNT(*) DESC
                   LIMIT 1
               ) AS primary_category
        FROM suppliers s
        ORDER BY s.name
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.put("/api/suppliers/<int:supplier_id>")
def update_supplier(supplier_id):
    data = request.get_json()
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("""
            UPDATE suppliers
            SET name=?, trade_name=?, vat_number=?, phone=?, email=?, address=?
            WHERE id=?
        """, (data.get("name"), data.get("trade_name"), data.get("vat_number"),
              data.get("phone"), data.get("email"), data.get("address"), supplier_id))
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 400
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/suppliers/<int:supplier_id>")
def delete_supplier(supplier_id):
    conn = get_db()
    cur  = conn.cursor()
    inv_cnt = cur.execute(
        "SELECT COUNT(*) FROM invoices WHERE supplier_id=?", (supplier_id,)
    ).fetchone()[0]
    if inv_cnt:
        conn.close()
        return jsonify({"error": f"Supplier has {inv_cnt} invoice(s) — merge into another supplier first."}), 400
    sp_cnt = cur.execute(
        "SELECT COUNT(*) FROM supplier_products WHERE supplier_id=?", (supplier_id,)
    ).fetchone()[0]
    if sp_cnt:
        conn.close()
        return jsonify({"error": f"Supplier has {sp_cnt} product(s) — merge into another supplier first."}), 400
    cur.execute("DELETE FROM suppliers WHERE id=?", (supplier_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/suppliers/<int:supplier_id>/merge")
def merge_supplier(supplier_id):
    data      = request.get_json()
    target_id = int(data.get("target_id", 0))
    if not target_id or target_id == supplier_id:
        return jsonify({"error": "Invalid target supplier"}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("UPDATE invoices SET supplier_id=? WHERE supplier_id=?",         (target_id, supplier_id))
    cur.execute("UPDATE supplier_products SET supplier_id=? WHERE supplier_id=?", (target_id, supplier_id))
    cur.execute("DELETE FROM suppliers WHERE id=?", (supplier_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/api/suppliers/<int:supplier_id>")
def get_supplier(supplier_id):
    conn = get_db()
    cur  = conn.cursor()

    row = cur.execute("SELECT * FROM suppliers WHERE id=?", (supplier_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    supplier = dict(row)

    # Aggregated stats — keep invoice totals and product count in separate queries
    # to avoid row multiplication from the invoice_lines join
    inv_stats = cur.execute("""
        SELECT COUNT(*)                        AS invoice_count,
               COALESCE(SUM(gross_amount), 0)  AS total_spend,
               COALESCE(SUM(net_amount),   0)  AS total_net,
               COALESCE(SUM(vat_amount),   0)  AS total_vat
        FROM invoices
        WHERE supplier_id = ?
    """, (supplier_id,)).fetchone()

    prod_count = cur.execute("""
        SELECT COUNT(DISTINCT product_id)
        FROM supplier_products
        WHERE supplier_id = ?
    """, (supplier_id,)).fetchone()[0]

    supplier["stats"] = {**dict(inv_stats), "product_count": prod_count}

    # Invoice list
    invoices = cur.execute("""
        SELECT i.id, i.invoice_number, i.invoice_date, i.status,
               i.net_amount, i.vat_amount, i.gross_amount,
               COUNT(il.id) AS line_count
        FROM invoices i
        LEFT JOIN invoice_lines il ON il.invoice_id = i.id
        WHERE i.supplier_id = ?
        GROUP BY i.id
        ORDER BY i.invoice_date DESC
    """, (supplier_id,)).fetchall()
    supplier["invoices"] = [dict(r) for r in invoices]

    # Product list with latest price
    products = cur.execute("""
        SELECT p.id, p.name, p.description, p.volume_ml, p.abv_percent,
               p.units_per_pack, p.pack_unit_size_ml, p.pack_unit_id,
               uom.abbreviation                        AS unit,
               puom.abbreviation                       AS pack_unit,
               pc.name                                 AS category,
               sp.id                                   AS supplier_product_id,
               sp.supplier_sku, sp.current_price,
               sp.total_quantity_ordered
        FROM supplier_products sp
        JOIN products p                ON p.id   = sp.product_id
        LEFT JOIN units_of_measure uom  ON uom.id  = p.unit_id
        LEFT JOIN units_of_measure puom ON puom.id = p.pack_unit_id
        LEFT JOIN product_categories pc ON pc.id   = p.category_id
        WHERE sp.supplier_id = ?
        ORDER BY p.name
    """, (supplier_id,)).fetchall()
    supplier["products"] = [dict(r) for r in products]

    conn.close()
    return jsonify(supplier)


@app.get("/api/units")
def get_units():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT id, name, abbreviation FROM units_of_measure ORDER BY name")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


# ── Invoices ──────────────────────────────────────────────────────────────

@app.get("/api/invoices/check-duplicate")
def check_duplicate_invoice():
    vat            = request.args.get("vat", "").strip()
    invoice_number = request.args.get("invoice_number", "").strip()
    if not vat or not invoice_number:
        return jsonify({"duplicate": False})
    conn = get_db()
    cur  = conn.cursor()
    row  = cur.execute("""
        SELECT i.id, i.invoice_date,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name
        FROM invoices i
        JOIN suppliers s ON s.id = i.supplier_id
        WHERE s.vat_number = ? AND i.invoice_number = ?
        LIMIT 1
    """, (vat, invoice_number)).fetchone()
    conn.close()
    if row:
        return jsonify({"duplicate": True,  "existing": dict(row)})
    return jsonify({"duplicate": False})


@app.get("/api/invoices")
def list_invoices():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT i.id, i.invoice_number, i.invoice_date, i.status,
               i.net_amount, i.vat_amount, i.excise_duty_amount, i.gross_amount,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name,
               COUNT(il.id)                              AS line_count
        FROM invoices i
        JOIN  suppliers s    ON s.id  = i.supplier_id
        LEFT JOIN invoice_lines il ON il.invoice_id = i.id
        GROUP BY i.id
        ORDER BY i.invoice_date DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.get("/api/invoices/<int:invoice_id>")
def get_invoice(invoice_id):
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT i.*, COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name
        FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.id = ?
    """, (invoice_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Not found"}), 404

    inv = dict(row)
    cur.execute("""
        SELECT il.*, uom.abbreviation AS unit, sp.supplier_sku,
               COALESCE(p.name, il.line_description) AS product_name
        FROM invoice_lines il
        LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
        LEFT JOIN supplier_products sp  ON sp.id  = il.supplier_product_id
        LEFT JOIN products p            ON p.id   = sp.product_id
        WHERE il.invoice_id = ?
        ORDER BY il.id
    """, (invoice_id,))
    inv["lines"] = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(inv)


@app.delete("/api/invoices/<int:invoice_id>")
def delete_invoice(invoice_id):
    conn = get_db()
    cur  = conn.cursor()

    if not cur.execute("SELECT id FROM invoices WHERE id=?", (invoice_id,)).fetchone():
        conn.close()
        return jsonify({"error": "Invoice not found"}), 404

    # Products that appear ONLY on this invoice (not referenced by any other invoice)
    cur.execute("""
        SELECT DISTINCT sp.product_id
        FROM invoice_lines il
        JOIN supplier_products sp ON sp.id = il.supplier_product_id
        WHERE il.invoice_id = ?
          AND sp.product_id NOT IN (
              SELECT DISTINCT sp2.product_id
              FROM invoice_lines il2
              JOIN supplier_products sp2 ON sp2.id = il2.supplier_product_id
              WHERE il2.invoice_id != ?
          )
    """, (invoice_id, invoice_id))
    exclusive_product_ids = [r[0] for r in cur.fetchall()]

    cur.execute("DELETE FROM invoice_lines WHERE invoice_id=?", (invoice_id,))
    lines_deleted = cur.rowcount

    # NULL out price_history rows that reference this invoice but belong to shared products
    # (exclusive-product price_history rows will be fully deleted below)
    cur.execute("UPDATE price_history SET invoice_id=NULL WHERE invoice_id=?", (invoice_id,))

    cur.execute("DELETE FROM invoices WHERE id=?", (invoice_id,))

    prods_deleted = 0
    for pid in exclusive_product_ids:
        cur.execute("""
            DELETE FROM price_history
            WHERE supplier_product_id IN (
                SELECT id FROM supplier_products WHERE product_id=?
            )
        """, (pid,))
        cur.execute("DELETE FROM supplier_products WHERE product_id=?", (pid,))
        cur.execute("DELETE FROM products WHERE id=?", (pid,))
        prods_deleted += cur.rowcount

    conn.commit()
    conn.close()
    return jsonify({
        "success":       True,
        "lines_deleted": lines_deleted,
        "products_deleted": prods_deleted,
    })


# ── Composite Products ────────────────────────────────────────────────────

def _calc_composite(cur, cp_id: int) -> dict:
    """Return cost + producibility data for one composite product."""
    rows = cur.execute("""
        SELECT cpc.id, cpc.quantity, cpc.unit,
               p.id   AS product_id,
               p.name AS product_name,
               COALESCE(p.units_per_pack, 1) AS units_per_pack,
               uom.abbreviation              AS product_unit,
               COALESCE(
                   (SELECT MIN(sp.current_price)
                    FROM supplier_products sp WHERE sp.product_id = p.id
                    AND sp.current_price IS NOT NULL), 0
               ) AS unit_price_wholesale,
               COALESCE(
                   (SELECT SUM(sp.total_quantity_ordered)
                    FROM supplier_products sp WHERE sp.product_id = p.id), 0
               ) AS stock_wholesale
        FROM composite_product_components cpc
        JOIN products p ON p.id = cpc.component_product_id
        LEFT JOIN units_of_measure uom ON uom.id = p.unit_id
        WHERE cpc.composite_product_id = ?
    """, (cp_id,)).fetchall()

    components   = []
    total_cost   = 0.0
    min_produce  = float("inf")
    bottleneck   = None

    for r in rows:
        r = dict(r)
        upp        = r["units_per_pack"] or 1
        unit_cost  = r["unit_price_wholesale"] / upp
        comp_cost  = r["quantity"] * unit_cost
        # stock expressed in retail units
        stock_ret  = r["stock_wholesale"] * upp
        can_produce = int(stock_ret // r["quantity"]) if r["quantity"] > 0 else 0

        r["unit_cost"]       = round(unit_cost, 4)
        r["component_cost"]  = round(comp_cost, 4)
        r["stock_retail"]    = round(stock_ret, 2)
        r["can_produce"]     = can_produce
        components.append(r)
        total_cost += comp_cost

        if can_produce < min_produce:
            min_produce = can_produce
            bottleneck  = r["product_name"]

    return {
        "components":    components,
        "total_food_cost": round(total_cost, 4),
        "max_producible":  int(min_produce) if min_produce != float("inf") else 0,
        "bottleneck":      bottleneck,
    }


@app.get("/api/composite-products")
def list_composite_products():
    conn = get_db()
    cur  = conn.cursor()
    cps  = cur.execute("SELECT * FROM composite_products ORDER BY name").fetchall()
    result = []
    for cp in [dict(r) for r in cps]:
        calc = _calc_composite(cur, cp["id"])
        sp   = cp.get("selling_price") or 0
        fc   = calc["total_food_cost"]
        cp["total_food_cost"]  = fc
        cp["component_count"]  = len(calc["components"])
        cp["max_producible"]   = calc["max_producible"]
        cp["margin_pct"]       = round((sp - fc) / sp * 100, 1) if sp > 0 else None
        result.append(cp)
    conn.close()
    return jsonify(result)


@app.get("/api/composite-products/<int:cp_id>")
def get_composite_product(cp_id):
    conn = get_db()
    cur  = conn.cursor()
    row  = cur.execute("SELECT * FROM composite_products WHERE id=?", (cp_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    cp   = dict(row)
    calc = _calc_composite(cur, cp_id)
    sp   = cp.get("selling_price") or 0
    fc   = calc["total_food_cost"]
    cp.update(calc)
    cp["margin_pct"] = round((sp - fc) / sp * 100, 1) if sp > 0 else None
    conn.close()
    return jsonify(cp)


@app.post("/api/composite-products")
def create_composite_product():
    data = request.get_json()
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        INSERT INTO composite_products (name, category, selling_price, servings, notes)
        VALUES (?, ?, ?, ?, ?)
    """, (data["name"], data.get("category"), data.get("selling_price"),
          data.get("servings", 1), data.get("notes")))
    cp_id = cur.lastrowid
    for comp in data.get("components", []):
        cur.execute("""
            INSERT INTO composite_product_components
                (composite_product_id, component_product_id, quantity, unit)
            VALUES (?, ?, ?, ?)
        """, (cp_id, comp["product_id"], comp["quantity"], comp.get("unit")))
    conn.commit()
    conn.close()
    return jsonify({"id": cp_id})


@app.put("/api/composite-products/<int:cp_id>")
def update_composite_product(cp_id):
    data = request.get_json()
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        UPDATE composite_products
        SET name=?, category=?, selling_price=?, servings=?, notes=?
        WHERE id=?
    """, (data["name"], data.get("category"), data.get("selling_price"),
          data.get("servings", 1), data.get("notes"), cp_id))
    cur.execute("DELETE FROM composite_product_components WHERE composite_product_id=?", (cp_id,))
    for comp in data.get("components", []):
        cur.execute("""
            INSERT INTO composite_product_components
                (composite_product_id, component_product_id, quantity, unit)
            VALUES (?, ?, ?, ?)
        """, (cp_id, comp["product_id"], comp["quantity"], comp.get("unit")))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/composite-products/<int:cp_id>")
def delete_composite_product(cp_id):
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("DELETE FROM composite_product_components WHERE composite_product_id=?", (cp_id,))
    cur.execute("DELETE FROM composite_products WHERE id=?", (cp_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Dashboard ─────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
def dashboard():
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM products")
    cur.execute("SELECT COUNT(*) FROM products");  n_products  = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM suppliers"); n_suppliers = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM invoices");  n_invoices  = cur.fetchone()[0]
    cur.execute("SELECT COALESCE(SUM(gross_amount),0) FROM invoices"); total_spend = cur.fetchone()[0]

    cur.execute("""
        SELECT i.id, i.invoice_number, i.invoice_date, i.gross_amount,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name
        FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
        ORDER BY i.invoice_date DESC LIMIT 6
    """)
    recent = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT pc.name, COUNT(p.id) AS cnt
        FROM products p JOIN product_categories pc ON pc.id = p.category_id
        GROUP BY pc.id ORDER BY cnt DESC LIMIT 12
    """)
    by_cat = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT COALESCE(NULLIF(s.trade_name,''), s.name) AS name,
               COUNT(i.id) AS invoices,
               COALESCE(SUM(i.gross_amount), 0) AS total
        FROM suppliers s LEFT JOIN invoices i ON i.supplier_id = s.id
        GROUP BY s.id ORDER BY total DESC
    """)
    by_sup = [dict(r) for r in cur.fetchall()]

    conn.close()
    return jsonify({
        "stats": {"products": n_products, "suppliers": n_suppliers,
                  "invoices": n_invoices, "total_spend": round(total_spend, 2)},
        "recent_invoices": recent,
        "by_category":     by_cat,
        "by_supplier":     by_sup,
    })


# ── Product update ─────────────────────────────────────────────────────────

@app.get("/api/products/<int:product_id>/invoices")
def product_invoices(product_id):
    conn = get_db()
    cur  = conn.cursor()
    rows = cur.execute("""
        SELECT i.id, i.invoice_number, i.invoice_date,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name,
               il.quantity,
               uom.abbreviation   AS unit,
               il.unit_price,
               il.discount_percent,
               il.line_net_amount,
               il.line_gross_amount
        FROM invoice_lines il
        JOIN invoices i   ON i.id  = il.invoice_id
        JOIN suppliers s  ON s.id  = i.supplier_id
        LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
        WHERE il.supplier_product_id IN (
            SELECT id FROM supplier_products WHERE product_id = ?
        )
        ORDER BY i.invoice_date DESC, i.id DESC
    """, (product_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.put("/api/products/<int:product_id>")
def update_product(product_id):
    d    = request.get_json(force=True)
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("""
            UPDATE products
            SET name              = ?,
                description       = ?,
                category_id       = ?,
                unit_id           = ?,
                volume_ml         = ?,
                abv_percent       = ?,
                units_per_pack    = ?,
                pack_unit_id      = ?,
                pack_unit_size_ml = ?
            WHERE id = ?
        """, (d.get("name"), d.get("description"),
              d.get("category_id")       or None,
              d.get("unit_id")           or None,
              d.get("volume_ml")         or None,
              d.get("abv_percent")       or None,
              d.get("units_per_pack")    or None,
              d.get("pack_unit_id")      or None,
              d.get("pack_unit_size_ml") or None,
              product_id))

        sp_id = d.get("supplier_product_id")
        if sp_id and d.get("supplier_sku") is not None:
            cur.execute("UPDATE supplier_products SET supplier_sku = ? WHERE id = ?",
                        (d["supplier_sku"], sp_id))

        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ── DB Browser ────────────────────────────────────────────────────────────

@app.get("/api/tables")
def list_tables():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    names  = [r[0] for r in cur.fetchall()]
    result = []
    for name in names:
        cur.execute(f"SELECT COUNT(*) FROM [{name}]")
        result.append({"name": name, "count": cur.fetchone()[0]})
    conn.close()
    return jsonify(result)


@app.get("/api/table/<table_name>")
def browse_table(table_name):
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    if not cur.fetchone():
        conn.close()
        return jsonify({"error": "Table not found"}), 404

    page     = max(1, int(request.args.get("page", 1)))
    per_page = int(request.args.get("per_page", 50))
    offset   = (page - 1) * per_page

    cur.execute(f"SELECT COUNT(*) FROM [{table_name}]")
    total = cur.fetchone()[0]

    cur.execute(f"SELECT * FROM [{table_name}] LIMIT ? OFFSET ?", (per_page, offset))
    rows = [dict(r) for r in cur.fetchall()]

    cur.execute(f"PRAGMA table_info([{table_name}])")
    columns = [{"name": r["name"], "type": r["type"]} for r in cur.fetchall()]

    conn.close()
    return jsonify({"columns": columns, "rows": rows,
                    "total": total, "page": page, "per_page": per_page})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
