from fastapi import Depends

from ..database import get_db
from ..domain.category_rules import infer_category_id
from ..domain.invoice_rules import normalize_vat
from ..domain.product_matching import names_similar
from ..domain.units import build_unit_map
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class ImportRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def import_invoices(self, invoices: list[dict]) -> tuple[list[int], list[dict]]:
        cur = self.db.cursor()
        unit_map = build_unit_map(cur)
        all_warnings: list[dict] = []
        ids: list[int] = []
        try:
            for inv in invoices:
                inv_id, warns = self._import_one(cur, inv, unit_map)
                ids.append(inv_id)
                all_warnings.extend(warns)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return ids, all_warnings

    def _import_one(self, cur, data: dict, unit_map: dict) -> tuple[int, list[dict]]:
        warnings: list[dict] = []
        is_credit = data.get("invoice_type", "invoice") == "credit_note"
        invoice_type = "credit_note" if is_credit else "invoice"

        s   = data["supplier"]
        vat = normalize_vat(s.get("name") or "unknown", s.get("vat_number"))
        s["vat_number"] = vat

        # When VAT is synthetic, reuse an existing supplier matched by name to
        # avoid creating duplicates from minor invoice-to-invoice name variations.
        if vat.startswith("NOVAT_"):
            existing = cur.execute(
                "SELECT id, vat_number FROM suppliers WHERE LOWER(name) = LOWER(%s)",
                (s.get("name", ""),),
            ).fetchone()
            if existing:
                vat = existing["vat_number"]
                s["vat_number"] = vat

        cur.execute("""
            INSERT INTO suppliers (name, trade_name, vat_number, phone, address)
            VALUES (%(name)s, %(trade_name)s, %(vat_number)s, %(phone)s, %(address)s)
            ON CONFLICT(vat_number) DO UPDATE SET
                name       = excluded.name,
                trade_name = excluded.trade_name,
                phone      = excluded.phone,
                address    = excluded.address
        """, s)
        supplier_id = cur.execute(
            "SELECT id FROM suppliers WHERE vat_number = %s", (vat,)
        ).fetchone()["id"]

        cur.execute("""
            INSERT INTO invoices
                (supplier_id, invoice_number, invoice_date,
                 net_amount, vat_amount, excise_duty_amount, gross_amount, invoice_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (supplier_id, data["invoice_number"], data["invoice_date"],
              data["net_amount"], data["vat_amount"],
              data.get("excise_duty_amount", 0), data["gross_amount"], invoice_type))
        invoice_id = cur.lastrowid

        for item in data.get("line_items", []):
            sp_id = None
            sku   = (item.get("supplier_sku") or "").strip() or None
            qty   = item.get("quantity") or 0
            desc  = (item.get("description") or "").strip()

            if sku:
                row = cur.execute("""
                    SELECT sp.id, p.name FROM supplier_products sp
                    JOIN products p ON p.id = sp.product_id
                    WHERE sp.supplier_id = %s AND sp.supplier_sku = %s
                """, (supplier_id, sku)).fetchone()
                if row:
                    sp_id = row["id"]
                    if not names_similar(row["name"], desc):
                        warnings.append({
                            "sku":           sku,
                            "existing_name": row["name"],
                            "invoice_name":  desc,
                            "message": (
                                f"SKU {sku}: invoice says \"{desc}\" "
                                f"but existing product is \"{row['name']}\""
                            ),
                        })
                    if not is_credit:
                        cur.execute("""
                            UPDATE supplier_products
                            SET current_price          = %s,
                                total_quantity_ordered = COALESCE(total_quantity_ordered, 0) + %s,
                                updated_at             = NOW()
                            WHERE id = %s
                        """, (item["unit_price"], qty, sp_id))
                    else:
                        cur.execute("""
                            UPDATE supplier_products
                            SET total_quantity_ordered = COALESCE(total_quantity_ordered, 0) - %s,
                                updated_at             = NOW()
                            WHERE id = %s
                        """, (qty, sp_id))
                else:
                    sp_id = self._create_product_and_supplier_product(
                        cur, supplier_id, desc, sku, item,
                        qty if not is_credit else 0, unit_map,
                    )

            elif desc:
                row = cur.execute("""
                    SELECT sp.id FROM supplier_products sp
                    JOIN products p ON p.id = sp.product_id
                    WHERE sp.supplier_id = %s AND sp.supplier_sku IS NULL
                      AND LOWER(p.name) = LOWER(%s)
                    LIMIT 1
                """, (supplier_id, desc)).fetchone()
                if row:
                    sp_id = row["id"]
                    if not is_credit:
                        cur.execute("""
                            UPDATE supplier_products
                            SET current_price          = %s,
                                total_quantity_ordered = COALESCE(total_quantity_ordered, 0) + %s,
                                updated_at             = NOW()
                            WHERE id = %s
                        """, (item["unit_price"], qty, sp_id))
                    else:
                        cur.execute("""
                            UPDATE supplier_products
                            SET total_quantity_ordered = COALESCE(total_quantity_ordered, 0) - %s,
                                updated_at             = NOW()
                            WHERE id = %s
                        """, (qty, sp_id))
                else:
                    sp_id = self._create_product_and_supplier_product(
                        cur, supplier_id, desc, None, item,
                        qty if not is_credit else 0, unit_map,
                    )

            line_unit_id = unit_map.get((item.get("unit") or "btl").lower(), 1)
            cur.execute("""
                INSERT INTO invoice_lines
                    (invoice_id, supplier_product_id, line_description,
                     quantity, unit_id, unit_price, discount_percent,
                     line_net_amount, vat_rate, excise_duty_per_unit, line_gross_amount)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (invoice_id, sp_id, desc, qty, line_unit_id,
                  item["unit_price"], item.get("discount_percent") or 0,
                  item["line_net_amount"], item.get("vat_rate") or 0,
                  item.get("excise_duty_per_unit") or 0, item["line_gross_amount"]))
            invoice_line_id = cur.lastrowid

            if sp_id:
                if not is_credit:
                    cur.execute("""
                        INSERT INTO price_history
                            (supplier_product_id, unit_price, vat_rate,
                             excise_duty_per_unit, effective_from, invoice_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (sp_id, item["unit_price"], item.get("vat_rate") or 0,
                          item.get("excise_duty_per_unit") or 0,
                          data["invoice_date"], invoice_id))

                product_row = cur.execute("""
                    SELECT sp.product_id,
                           COALESCE(pc.is_service, FALSE) AS is_service
                    FROM supplier_products sp
                    JOIN products p ON p.id = sp.product_id
                    LEFT JOIN product_categories pc ON pc.id = p.category_id
                    WHERE sp.id = %s
                """, (sp_id,)).fetchone()
                product_id = product_row["product_id"]
                is_service_item = product_row["is_service"]

                if not is_service_item:
                    post_movements(
                        cur.connection,
                        [{
                            "product_id": product_id,
                            "location_id": item.get("location_id") or 1,
                            "movement_type": "return_to_supplier" if is_credit else "purchase_receipt",
                            "quantity": -qty if is_credit else qty,
                            "unit_id": line_unit_id,
                            "reference_id": invoice_line_id,
                            "reference_type": "invoice_line",
                            "moved_at": data["invoice_date"],
                        }],
                        commit=False,
                    )

        return invoice_id, warnings

    def suggest_locations(self, descriptions: list[str]) -> list[int | None]:
        results: list[int | None] = []
        for desc in descriptions:
            suggestion = None
            if desc.strip():
                row = self.db.execute(
                    "SELECT id FROM products WHERE LOWER(name) = LOWER(%s)", (desc.strip(),)
                ).fetchone()
                if row:
                    bal = self.db.execute(
                        """SELECT location_id FROM inventory_balances
                           WHERE product_id = %s AND quantity > 0
                           ORDER BY quantity DESC LIMIT 1""",
                        (row["id"],),
                    ).fetchone()
                    if bal:
                        suggestion = bal["location_id"]
            results.append(suggestion)
        return results

    def _create_product_and_supplier_product(
        self,
        cur,
        supplier_id: int,
        desc: str,
        sku: str | None,
        item: dict,
        qty: float,
        unit_map: dict,
    ) -> int:
        cat_id  = infer_category_id(desc, cur)
        unit_id = unit_map.get((item.get("unit") or "").lower())
        cur.execute(
            "INSERT INTO products (name, description, category_id, unit_id) VALUES (%s, %s, %s, %s)",
            (desc, desc, cat_id, unit_id),
        )
        product_id = cur.lastrowid
        cur.execute("""
            INSERT INTO supplier_products
                (supplier_id, product_id, supplier_sku,
                 supplier_product_name, current_price, total_quantity_ordered, is_preferred_supplier)
            VALUES (%s, %s, %s, %s, %s, %s, 1)
        """, (supplier_id, product_id, sku, desc, item["unit_price"], qty))
        return cur.lastrowid


def get_import_repo(db: DBConnection = Depends(get_db)) -> ImportRepository:
    return ImportRepository(db)
