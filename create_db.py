"""Development seed script.

Creates (or updates) the database by running all versioned migrations, then
inserts development fixture data (one real supplier, real products, and two
sample invoices).

Schema is owned exclusively by the migration files in backend/migrations/.
Do NOT add CREATE TABLE statements here.
"""
import os
import sys
from pathlib import Path

# Allow importing the migration runner without installing the package.
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from migrations.runner import run_migrations

DB_PATH = os.path.join(os.path.dirname(__file__), "zubro_food_cost.db")

# ── 1. Apply all migrations (schema + reference data) ────────────────────────
print("Applying migrations…")
run_migrations(DB_PATH)

# ── 2. Seed development fixtures ─────────────────────────────────────────────
import sqlite3

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON")
cur = conn.cursor()

# ── Supplier ──────────────────────────────────────────────────────────────────
cur.execute("""
    INSERT OR IGNORE INTO suppliers
        (id, name, trade_name, vat_number, phone, address, payment_terms, is_active)
    VALUES
        (1,
         'ΕΜΜ. & ΕΛ. ΓΕΩΡΓΙΛΑΚΗΣ Ο.Ε.',
         'Cava Drosia',
         '092868930',
         '210 8142 947',
         'Λ. Δροσιάς - Σταθμός 3, Δροσιά',
         'Cash on delivery',
         1)
""")

# ── Products ──────────────────────────────────────────────────────────────────
# (id, name, description, cat_id, unit_id, vol_ml, abv)
products = [
    (1,  "Five Lakes Vodka",                  "Five Lakes Vodka 700ml",                        11, 1, 700,  40.0),
    (2,  "Καραβιτάκη Μικρός Πρίγκηπας Λευκό","Καραβιτάκη Μικρός Πρίγκηπας Λευκό 750ml",       6, 1, 750,  13.0),
    (3,  "Red Bull Energy Apricot",           "Red Bull Energy Apricot 250ml",                  22, 5, 250,   0.0),
    (4,  "Kirki Pale Ale",                    "Kirki (Κίρκη) Pale Ale Beer 330ml",               4, 5, 330,   5.0),
    (5,  "Καλύβα Sauvignon Blanc",            "Καλύβα Sauvignon Blanc 750ml",                    6, 1, 750,  12.5),
    (6,  "Αργυρίου Μαλαγουζιά",              "Αργυρίου Μαλαγουζιά 750ml",                       6, 1, 750,  13.0),
    (7,  "Borrasti Λευκός",                   "Borrasti Λευκός 750ml",                           6, 1, 750,  12.5),
    (8,  "Buen Amigo Κομψός Λευκό",           "Buen Amigo Κομψός Λευκό 750ml",                   6, 1, 750,  12.5),
    (9,  "Κτήμα Γεροβασιλείου Μαλαγουζιά",   "Κτήμα Γεροβασιλείου Μαλαγουζιά 750ml",            6, 1, 750,  13.0),
    (10, "La Tour Melas Ιδύλλη Achinos Rosé", "La Tour Melas Ιδύλλη & Achinos Rosé 750ml",       7, 1, 750,  12.5),
    (11, "Borrasti Rosé",                     "Borrasti Rosé 750ml",                             7, 1, 750,  12.5),
    (12, "Truffle Hunter Blush Rosé",         "Truffle Hunter Blush Rosé 750ml",                 7, 1, 750,  12.5),
    (13, "Borrasti Ερυθρός",                  "Borrasti Ερυθρός 750ml",                          8, 1, 750,  13.0),
    (14, "Οινόφυλλα Απλά Ερυθρός",           "Οινόφυλλα Απλά Ερυθρός 750ml",                    8, 1, 750,  13.0),
    (15, "Gancia Moscato d'Asti",             "Gancia DOCG Moscato d'Asti 750ml",                9, 1, 750,   5.5),
    (16, "Ponthier Passion Purée",            "Ponthier Passion Purée Ψυγείου Ασκός 1kg",        21, 3,None,   0.0),
    (17, "Ponthier Pineapple Purée",          "Ponthier Pineapple Purée Ψυγείου Ασκός 1kg",      21, 3,None,   0.0),
    (18, "Ponthier Strawberry Purée",         "Ponthier Strawberry Purée Ψυγείου Ασκός 1kg",     21, 3,None,   0.0),
    (19, "Giffard Vanilla Syrup",             "Giffard Vanilla Syrup 1lt",                        20, 4,1000,   0.0),
    (20, "Giffard Orgeat Syrup",              "Giffard Orgeat (Σουμάδα) Syrup 1lt",               20, 4,1000,   0.0),
    (21, "Giffard Cucumber Syrup",            "Giffard Cucumber Syrup 1lt",                       20, 4,1000,   0.0),
    (22, "Giffard Mangalore Liqueur",         "Giffard Mangalore Liqueur 700ml",                  16, 1, 700,  20.0),
    (23, "Pony & Jigger Triple Sec",          "Pony & Jigger Davy Triple Sec Liqueur 700ml",      16, 1, 700,  40.0),
    (24, "Planteray 3 Stars Silver Rum",      "Planteray 3 Stars Silver Rum 700ml",               13, 1, 700,  41.2),
    (25, "Planteray Original Dark Rum",       "Planteray Original Dark Rum 700ml",                13, 1, 700,  40.0),
    (26, "Planteray O.F.T.D Overproof Rum",   "Planteray O.F.T.D Overproof Rum 700ml",            13, 1, 700,  69.0),
    (27, "Buen Amigo Silver Tequila",         "Buen Amigo Silver Tequila 700ml",                  14, 1, 700,  38.0),
    (28, "Buen Amigo Gold Tequila",           "Buen Amigo Gold Tequila 700ml",                    14, 1, 700,  38.0),
    (29, "MC Gin",                            "MC Gin 700ml",                                     12, 1, 700,  40.0),
    (30, "Aperol Aperitivo",                  "Aperol Aperitivo 1lt",                             17, 4,1000,  11.0),
    (31, "Sagatiba Pura Cachaça",             "Sagatiba Pura Cachaça 700ml",                      18, 1, 700,  38.0),
    (32, "Tanqueray Gin",                     "Tanqueray Gin 700ml",                              12, 1, 700,  43.1),
    (33, "Tanqueray No.10 Gin",               "Tanqueray No.10 Gin 700ml",                        12, 1, 700,  47.3),
    (34, "Hendrick's Gin",                    "Hendrick's Gin 700ml",                             12, 1, 700,  41.4),
    (35, "Belvedere Organic Vodka",           "Belvedere Organic Vodka 700ml",                    11, 1, 700,  40.0),
    (36, "Maker's Mark Whiskey",              "Maker's Mark Whiskey 700ml",                       15, 1, 700,  45.0),
    (37, "Jack Daniel's Whiskey",             "Jack Daniel's Whiskey 700ml",                      15, 1, 700,  40.0),
    (38, "Jameson Black Label",               "Jameson Black Label Whiskey 700ml",                15, 1, 700,  40.0),
    (39, "Diplomatico Reserva Exclusiva",     "Diplomatico 12yr Reserva Exclusiva Rum 700ml",     13, 1, 700,  40.0),
    (40, "Don Julio Reposado Tequila",        "Don Julio Reposado Tequila 700ml",                 14, 1, 700,  38.0),
    (41, "Don Julio Blanco Tequila",          "Don Julio Blanco Tequila 700ml",                   14, 1, 700,  38.0),
]
cur.executemany(
    "INSERT OR IGNORE INTO products "
    "(id, name, description, category_id, unit_id, volume_ml, abv_percent) "
    "VALUES (?,?,?,?,?,?,?)",
    products,
)

# ── Supplier products ─────────────────────────────────────────────────────────
supplier_products = [
    (1,  1,  1,  "6302080", "FIVE LAKES VODKA 700ml",                            7.0003, 1),
    (2,  1,  2,  "6161476", "ΚΑΡΑΒΙΤΑΚΗ ΜΙΚΡΟΣ ΠΡΙΓΚΗΠΑΣ ΛΕΥΚΟ 750ml",          5.8500, 1),
    (3,  1,  3,  "2206031", "RED BULL ENERGY APRICOT ΚΟΥΤΙ 250ml",               1.1900, 1),
    (4,  1,  4,  "3104605", "KIRKI (ΚΙΡΚΗ) PALE ALE BEER 330ml",                 1.9400, 1),
    (5,  1,  5,  "4117070", "ΚΑΛΥΑ SAUVIGNON BLANC 750ml",                       5.6130, 1),
    (6,  1,  6,  "4147370", "ΑΡΓΥΡΙΟΥ ΜΑΛΑΓΟΥΖΙΑ 750ml",                         9.2000, 1),
    (7,  1,  7,  "4141937", "BORRASTI ΛΕΥΚΟΣ 750ml",                             4.7500, 1),
    (8,  1,  8,  "4161473", "BUEN AMIGO ΚΟΜΨΟΣ ΛΕΥΚΟ 750ml",                     4.7500, 1),
    (9,  1,  9,  "4134127", "ΚΤΗΜΑ ΓΕΡΟΒΑΣΙΛΕΙΟΥ ΜΑΛΑΓΟΥΖΙΑ 750ml",             14.3000, 1),
    (10, 1, 10,  "4160873", "LA TOUR MELAS ΙΔΥΛΛΗ & ACHINOS ΡΟΖΕ 750ml",         6.8700, 1),
    (11, 1, 11,  "4141939", "BORRASTI ΡΟΖΕ 750ml",                               4.7500, 1),
    (12, 1, 12,  "4238471", "TRUFFLE HUNTER BLUSH ΡΟΖΕ 750ml",                  13.0000, 1),
    (13, 1, 13,  "4141938", "BORRASTI ΕΡΥΘΡΟΣ 750ml",                            4.7500, 1),
    (14, 1, 14,  "4140703", "ΟΙΝΟΦΥΛΛΑ ΑΠΛΑ ΕΡΥΘΡΟΣ 750ml",                    12.0000, 1),
    (15, 1, 15,  "4255010", "GANCIA DOCG MOSCATO D'ASTI 750ml",                 12.0000, 1),
    (16, 1, 16,  "1224533", "PONTHIER PASSION ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",       12.3000, 1),
    (17, 1, 17,  "1224534", "PONTHIER PINEAPPLE ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",     10.4000, 1),
    (18, 1, 18,  "1224535", "PONTHIER STRAWBERRY ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",    10.4000, 1),
    (19, 1, 19,  "1224719", "GIFFARD VANILLA (ΒΑΝΙΛΙΑ) SYRUP 1LT",              10.9500, 1),
    (20, 1, 20,  "1224724", "GIFFARD ORGEAT (ΣΟΥΜΑΔΑ) SYRUP 1LT",               10.9500, 1),
    (21, 1, 21,  "1224725", "GIFFARD CUCUMBER (CONCOMBRE/ΑΓΓΟΥΡΙ) SYRUP 1LT",   9.9500, 1),
    (22, 1, 22,  "5210634", "GIFFARD MANGALORE LIQUEUR 700ml",                  15.6500, 1),
    (23, 1, 23,  "5211010", "PONY & JIGGER DAVY TRIPLE SEC LIQUEUR 700ml",      11.7500, 1),
    (24, 1, 24,  "6216070", "PLANTERAY 3 STARS SILVER RUM 700ml",                9.2500, 1),
    (25, 1, 25,  "6216072", "PLANTERAY ORIGINAL DARK RUM 700ml",                10.3000, 1),
    (26, 1, 26,  "6216075", "PLANTERAY O.F.T.D OVERPROOF RUM 700ml",            15.9000, 1),
    (27, 1, 27,  "6502015", "BUEN AMIGO SILVER TEQUILA 700ml",                   8.8000, 1),
    (28, 1, 28,  "6502016", "BUEN AMIGO GOLD TEQUILA 700ml",                     9.2000, 1),
    (29, 1, 29,  None,      "MC GIN 700ml",                                      7.2000, 1),
    (30, 1, 30,  "6210500", "APEROL APERITIVO 1LT",                             10.1500, 1),
    (31, 1, 31,  "6213870", "SAGATIBA PURA CACHAÇA 700ml",                       6.0000, 1),
    (32, 1, 32,  "6403038", "TANQUERAY GIN 700ml",                              13.8600, 1),
    (33, 1, 33,  "6403071", "TANQUERAY NO.10 GIN 700ml",                        20.6000, 1),
    (34, 1, 34,  "6413072", "HENDRICK'S GIN 700ml",                             24.3800, 1),
    (35, 1, 35,  "6130109", "BELVEDERE ORGANIC VODKA 700ml",                    35.0300, 1),
    (36, 1, 36,  "6172070", "MAKER'S MARK WHISKEY 700ml",                       23.0750, 1),
    (37, 1, 37,  "6142070", "JACK DANIEL'S WHISKEY 700ml",                      17.3140, 1),
    (38, 1, 38,  "6142900", "JAMESON BLACK LABEL WHISKEY 700ml",                20.7800, 1),
    (39, 1, 39,  "6234070", "DIPLOMATICO 12YR RESERVA EXCLUSIVA RUM 700ml",     25.0000, 1),
    (40, 1, 40,  "507070",  "DON JULIO REPOSADO TEQUILA 700ml",                 42.8100, 1),
    (41, 1, 41,  "507220",  "DON JULIO BLANCO TEQUILA 700ml",                   38.3700, 1),
]
cur.executemany(
    "INSERT OR IGNORE INTO supplier_products "
    "(id, supplier_id, product_id, supplier_sku, supplier_product_name, "
    "current_price, is_preferred_supplier) VALUES (?,?,?,?,?,?,?)",
    supplier_products,
)

# ── Invoices ──────────────────────────────────────────────────────────────────
cur.executemany(
    "INSERT OR IGNORE INTO invoices "
    "(id, supplier_id, invoice_number, invoice_date, "
    "net_amount, vat_amount, excise_duty_amount, gross_amount, status) "
    "VALUES (?,?,?,?,?,?,?,?,?)",
    [
        (1, 1, "1129-A", "2026-04-02",   75.67,  17.12,  21.42,  116.13, "received"),
        (2, 1, "1129-B", "2026-04-01", 1241.90, 286.74, 216.10, 1529.64, "received"),
    ],
)

# ── Invoice lines ─────────────────────────────────────────────────────────────
invoice_lines = [
    # Invoice 1 (1129-A)
    (1,  1, "FIVE LAKES VODKA 700ml",                    3.0,  1,  7.0003, 0, 21.00, 24.0,  5.00,  37.80),
    (1,  2, "ΚΑΡΑΒΙΤΑΚΗ ΜΙΚΡΟΣ ΠΡΙΓΚΗΠΑΣ ΛΕΥΚΟ 750ml",  6.0,  1,  5.8500, 0, 35.10, 24.0, 20.00,  62.52),
    (1,  3, "RED BULL ENERGY APRICOT ΚΟΥΤΙ 250ml",      24.0,  5,  1.1900, 0, 28.56,  7.0,  0.00,  30.56),
    (1, None, "ΧΡΕΩΣΗ ΠΑΛΕΤΩΝ (Pallet Charge)",           1.0,  6,  9.0000, 0,  9.00, 24.0,  0.00,  11.16),
    # Invoice 2 (1129-B)
    (2,  4, "KIRKI PALE ALE BEER 330ml",                       20.0, 5,  1.9400, 0,  38.80,  0.0,  0.0,  38.80),
    (2,  5, "ΚΑΛΥΑ SAUVIGNON BLANC 750ml",                      6.0, 1,  5.6130, 0,  33.68, 24.0,  0.0,  41.76),
    (2,  6, "ΑΡΓΥΡΙΟΥ ΜΑΛΑΓΟΥΖΙΑ 750ml",                        2.0, 1,  9.2000, 0,  18.40, 24.0,  0.0,  22.82),
    (2,  7, "BORRASTI ΛΕΥΚΟΣ 750ml",                            6.0, 1,  4.7500, 0,  28.50, 24.0,  0.0,  35.34),
    (2,  8, "BUEN AMIGO ΚΟΜΨΟΣ ΛΕΥΚΟ 750ml",                    6.0, 1,  4.7500, 0,  28.50, 24.0,  0.0,  35.34),
    (2,  9, "ΚΤΗΜΑ ΓΕΡΟΒΑΣΙΛΕΙΟΥ ΜΑΛΑΓΟΥΖΙΑ 750ml",             6.0, 1, 14.3000, 0,  85.80, 24.0,  0.0, 106.39),
    (2, 10, "LA TOUR MELAS ΙΔΥΛΛΗ & ACHINOS ΡΟΖΕ 750ml",        4.0, 1,  6.8700, 0,  27.48, 24.0,  0.0,  34.08),
    (2, 11, "BORRASTI ΡΟΖΕ 750ml",                               6.0, 1,  4.7500, 0,  28.50, 24.0,  0.0,  35.34),
    (2, 12, "TRUFFLE HUNTER BLUSH ΡΟΖΕ 750ml",                   2.0, 1, 13.0000, 0,  26.00, 24.0,  0.0,  32.24),
    (2, 13, "BORRASTI ΕΡΥΘΡΟΣ 750ml",                            6.0, 1,  4.7500, 0,  28.50, 24.0,  0.0,  35.34),
    (2, 14, "ΟΙΝΟΦΥΛΛΑ ΑΠΛΑ ΕΡΥΘΡΟΣ 750ml",                     2.0, 1, 12.0000, 0,  24.00, 24.0,  0.0,  29.76),
    (2, 15, "GANCIA DOCG MOSCATO D'ASTI 750ml",                  2.0, 1, 12.0000, 0,  24.00, 24.0,  0.0,  29.76),
    (2, 16, "PONTHIER PASSION ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",        1.0, 3, 12.3000, 0,  12.30, 24.0,  0.0,  15.25),
    (2, 17, "PONTHIER PINEAPPLE ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",      1.0, 3, 10.4000, 0,  10.40, 24.0,  0.0,  12.90),
    (2, 18, "PONTHIER STRAWBERRY ΠΟΥΡΕΣ ΨΥΓΕΙΟΥ ΑΣΚΟΣ 1KG",     1.0, 3, 10.4000, 0,  10.40, 24.0,  0.0,  12.90),
    (2, 19, "GIFFARD VANILLA SYRUP 1LT",                         1.0, 4, 10.9500, 0,  10.95, 24.0,  0.0,  13.58),
    (2, 20, "GIFFARD ORGEAT SYRUP 1LT",                          1.0, 4, 10.9500, 0,  10.95, 24.0,  0.0,  13.58),
    (2, 21, "GIFFARD CUCUMBER SYRUP 1LT",                        1.0, 4,  9.9500, 0,   9.95, 24.0,  0.0,  12.34),
    (2, 22, "GIFFARD MANGALORE LIQUEUR 700ml",                   1.0, 1, 15.6500, 0,  15.65, 24.0,  7.14, 26.96),
    (2, 23, "PONY & JIGGER TRIPLE SEC LIQUEUR 700ml",            1.0, 1, 11.7500, 0,  11.75, 24.0,  4.28, 19.57),
    (2, 24, "PLANTERAY 3 STARS SILVER RUM 700ml",                1.0, 1,  9.2500, 0,   9.25, 24.0,  8.23, 19.73),
    (2, 25, "PLANTERAY ORIGINAL DARK RUM 700ml",                 1.0, 1, 10.3000, 0,  10.30, 24.0,  8.23, 20.78),
    (2, 26, "PLANTERAY O.F.T.D OVERPROOF RUM 700ml",             2.0, 1, 15.9000, 0,  31.80, 24.0, 13.70, 72.90),
    (2, 27, "BUEN AMIGO SILVER TEQUILA 700ml",                   2.0, 1,  8.8000, 0,  17.60, 24.0,  7.50, 36.88),
    (2, 28, "BUEN AMIGO GOLD TEQUILA 700ml",                     2.0, 1,  9.2000, 0,  18.40, 24.0,  7.50, 37.68),
    (2, 29, "MC GIN 700ml",                                      1.0, 1,  7.2000, 0,   7.20, 24.0,  3.44, 12.57),
    (2, 30, "APEROL APERITIVO 1LT",                              2.0, 4, 10.1500, 0,  20.30, 24.0,  3.13, 31.38),
    (2, 31, "SAGATIBA PURA CACHAÇA 700ml",                       1.0, 1,  6.0000, 0,   6.00, 24.0,  6.98, 14.42),
    (2, 32, "TANQUERAY GIN 700ml",                               6.0, 1, 13.8600, 0,  83.16, 24.0,  4.99,119.84),
    (2, 33, "TANQUERAY NO.10 GIN 700ml",                         2.0, 1, 20.6000, 0,  41.20, 24.0,  4.99, 61.06),
    (2, 34, "HENDRICK'S GIN 700ml",                              6.0, 1, 24.3800, 0, 146.28, 24.0,  4.99,211.22),
    (2, 35, "BELVEDERE ORGANIC VODKA 700ml",                     2.0, 1, 35.0300, 0,  70.06, 24.0,  5.00, 96.87),
    (2, 36, "MAKER'S MARK WHISKEY 700ml",                        2.0, 1, 23.0750, 0,  46.15, 24.0,  7.40, 72.07),
    (2, 37, "JACK DANIEL'S WHISKEY 700ml",                       6.0, 1, 17.3140, 0, 103.88, 24.0,  7.40,194.55),
    (2, 38, "JAMESON BLACK LABEL WHISKEY 700ml",                 2.0, 1, 20.7800, 0,  41.56, 24.0,  7.40, 65.66),
    (2, 39, "DIPLOMATICO RESERVA EXCLUSIVA RUM 700ml",           2.0, 1, 25.0000, 0,  50.00, 24.0,  8.23, 78.50),
    (2, 40, "DON JULIO REPOSADO TEQUILA 700ml",                  2.0, 1, 42.8100, 0,  85.62, 24.0, 13.50,138.05),
    (2, 41, "DON JULIO BLANCO TEQUILA 700ml",                    1.0, 1, 38.3700, 0,  38.37, 24.0, 13.50, 65.12),
]
cur.executemany(
    "INSERT OR IGNORE INTO invoice_lines "
    "(invoice_id, supplier_product_id, line_description, quantity, unit_id, "
    "unit_price, discount_percent, line_net_amount, vat_rate, "
    "excise_duty_per_unit, line_gross_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    invoice_lines,
)

# ── Price history (derived from invoice lines) ────────────────────────────────
cur.execute("""
    INSERT OR IGNORE INTO price_history
        (supplier_product_id, unit_price, vat_rate, excise_duty_per_unit, effective_from, invoice_id)
    SELECT DISTINCT
        il.supplier_product_id,
        il.unit_price,
        il.vat_rate,
        il.excise_duty_per_unit,
        i.invoice_date,
        i.id
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE il.supplier_product_id IS NOT NULL
""")

conn.commit()
conn.close()
print(f"Database seeded: {DB_PATH}")
