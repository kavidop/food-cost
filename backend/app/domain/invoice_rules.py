"""Domain rules for invoice validation and duplicate detection."""


def normalize_vat(supplier_name: str, vat_number: str | None) -> str:
    """Return a valid VAT string, generating a synthetic one when absent.

    Suppliers without a VAT number get a deterministic synthetic key so they
    can still be upserted without triggering a unique-constraint violation.
    """
    vat = (vat_number or "").strip()
    if not vat:
        vat = "NOVAT_" + supplier_name.replace(" ", "_")[:20]
    return vat


def find_duplicate(cur, vat: str, invoice_number: str) -> dict | None:
    """Return the existing invoice row as a dict, or None if no duplicate exists."""
    row = cur.execute("""
        SELECT i.id, i.invoice_date,
               COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name
        FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE s.vat_number = %s AND i.invoice_number = %s
        LIMIT 1
    """, (vat, invoice_number)).fetchone()
    return dict(row) if row else None
