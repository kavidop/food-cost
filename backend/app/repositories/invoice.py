from fastapi import Depends

from ..database import get_db
from ..domain.invoice_rules import find_duplicate
from ..protocols import DBConnection


class InvoiceRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_invoices(
        self,
        supplier_id: int | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        sort_by: str = "invoice_date",
        sort_dir: str = "desc",
    ) -> list[dict]:
        conditions: list[str] = []
        params: list = []

        if supplier_id:
            conditions.append("i.supplier_id = %s")
            params.append(supplier_id)
        if date_from:
            conditions.append("i.invoice_date >= %s")
            params.append(date_from)
        if date_to:
            conditions.append("i.invoice_date <= %s")
            params.append(date_to)

        where = " WHERE " + " AND ".join(conditions) if conditions else ""

        sort_col  = "i.invoice_date" if sort_by == "invoice_date" else "supplier_name"
        direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
        secondary = "supplier_name ASC" if sort_col == "i.invoice_date" else "i.invoice_date DESC"

        rows = self.db.execute(f"""
            SELECT i.id, i.invoice_number, i.invoice_date, i.invoice_type, i.status,
                   COALESCE(SUM(il.line_net_amount), 0)                        AS net_amount,
                   COALESCE(SUM(il.line_gross_amount - il.line_net_amount), 0) AS vat_amount,
                   i.excise_duty_amount,
                   COALESCE(SUM(il.line_gross_amount), 0)                      AS gross_amount,
                   COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name,
                   COUNT(il.id) AS line_count
            FROM invoices i
            JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN invoice_lines il ON il.invoice_id = i.id
            {where}
            GROUP BY i.id, i.invoice_number, i.invoice_date, i.invoice_type, i.status,
                     i.excise_duty_amount, s.trade_name, s.name
            ORDER BY {sort_col} {direction}, {secondary}
        """, params if params else None).fetchall()
        return [dict(r) for r in rows]

    def get_invoice(self, invoice_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT i.*, COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name,
                   0 AS line_count
            FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
            WHERE i.id = %s
        """, (invoice_id,)).fetchone()
        if not row:
            return None

        inv = dict(row)
        lines = self.db.execute("""
            SELECT il.*, uom.abbreviation AS unit, sp.supplier_sku,
                   sp.product_id,
                   COALESCE(p.name, il.line_description) AS product_name
            FROM invoice_lines il
            LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
            LEFT JOIN supplier_products sp  ON sp.id  = il.supplier_product_id
            LEFT JOIN products p            ON p.id   = sp.product_id
            WHERE il.invoice_id = %s
            ORDER BY il.id
        """, (invoice_id,)).fetchall()

        inv["lines"]      = [dict(l) for l in lines]
        inv["line_count"] = len(inv["lines"])
        return inv

    def update_invoice(
        self,
        invoice_id:     int,
        invoice_date:   str,
        invoice_number: str,
        invoice_type:   str,
        delivery_date:  str | None,
        notes:          str | None,
    ) -> bool:
        result = self.db.execute("""
            UPDATE invoices
            SET invoice_date   = %s,
                invoice_number = %s,
                invoice_type   = %s,
                delivery_date  = %s,
                notes          = %s
            WHERE id = %s
        """, (invoice_date, invoice_number, invoice_type, delivery_date, notes, invoice_id))
        self.db.commit()
        return (result.rowcount or 0) > 0

    def delete_invoice(self, invoice_id: int) -> dict | None:
        cur = self.db.cursor()
        if not cur.execute("SELECT id FROM invoices WHERE id=%s", (invoice_id,)).fetchone():
            return None

        line_rows = cur.execute(
            "SELECT id, supplier_product_id, quantity FROM invoice_lines WHERE invoice_id=%s",
            (invoice_id,),
        ).fetchall()
        line_ids = [r[0] for r in line_rows]

        exclusive_pids = [r[0] for r in cur.execute("""
            SELECT DISTINCT sp.product_id
            FROM invoice_lines il
            JOIN supplier_products sp ON sp.id = il.supplier_product_id
            WHERE il.invoice_id = %s
              AND sp.product_id NOT IN (
                  SELECT DISTINCT sp2.product_id
                  FROM invoice_lines il2
                  JOIN supplier_products sp2 ON sp2.id = il2.supplier_product_id
                  WHERE il2.invoice_id != %s
              )
        """, (invoice_id, invoice_id)).fetchall()]

        if line_ids:
            placeholders = ",".join(["%s"] * len(line_ids))
            cur.execute(
                f"""
                DELETE FROM stock_movements
                WHERE reference_type = 'invoice_line'
                  AND reference_id IN ({placeholders})
                """,
                line_ids,
            )
            self._rebuild_inventory_balances(cur)

        qty_by_sp: dict[int, float] = {}
        for row in line_rows:
            sp_id = row["supplier_product_id"]
            qty = row["quantity"]
            if sp_id is None:
                continue
            qty_by_sp[sp_id] = qty_by_sp.get(sp_id, 0.0) + float(qty)
        for sp_id, qty in qty_by_sp.items():
            cur.execute(
                """
                UPDATE supplier_products
                SET total_quantity_ordered = GREATEST(COALESCE(total_quantity_ordered, 0) - %s, 0),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (qty, sp_id),
            )

        cur.execute("DELETE FROM invoice_lines WHERE invoice_id=%s", (invoice_id,))
        lines_deleted = cur.rowcount
        cur.execute("UPDATE price_history SET invoice_id=NULL WHERE invoice_id=%s", (invoice_id,))
        cur.execute("DELETE FROM invoices WHERE id=%s", (invoice_id,))

        prods_deleted = 0
        for pid in exclusive_pids:
            cur.execute("""
                DELETE FROM price_history WHERE supplier_product_id IN (
                    SELECT id FROM supplier_products WHERE product_id=%s
                )
            """, (pid,))
            cur.execute("DELETE FROM supplier_products WHERE product_id=%s", (pid,))
            if self._can_delete_product(cur, pid):
                try:
                    cur.execute("SAVEPOINT sp_del_prod")
                    cur.execute("DELETE FROM products WHERE id=%s", (pid,))
                    prods_deleted += cur.rowcount
                    cur.execute("RELEASE SAVEPOINT sp_del_prod")
                except Exception:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_del_prod")

        self.db.commit()
        return {"success": True, "lines_deleted": lines_deleted, "products_deleted": prods_deleted}

    def set_pdf_path(self, invoice_id: int, pdf_path: str) -> None:
        self.db.execute("UPDATE invoices SET pdf_path = %s WHERE id = %s", (pdf_path, invoice_id))

    def check_duplicate(self, vat: str, invoice_number: str) -> tuple[bool, dict | None]:
        existing = find_duplicate(self.db.cursor(), vat, invoice_number)
        return (True, existing) if existing else (False, None)

    def _rebuild_inventory_balances(self, cur) -> None:
        cur.execute("DELETE FROM inventory_balances")
        cur.execute(
            """
            INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
            SELECT
                sm.product_id,
                sm.location_id,
                ROUND(SUM(sm.quantity)::numeric, 6) AS quantity,
                MIN(sm.unit_id) AS unit_id
            FROM stock_movements sm
            GROUP BY sm.product_id, sm.location_id
            HAVING ABS(SUM(sm.quantity)) > 0.0000001
            """
        )

    def _can_delete_product(self, cur, product_id: int) -> bool:
        checks = [
            ("inventory_balances", "product_id"),
            ("waste_events", "product_id"),
            ("composite_product_components", "component_product_id"),
            ("unit_conversions", "product_id"),
            ("recipe_yields", "yield_product_id"),
            ("stock_count_lines", "product_id"),
            ("stock_movements", "product_id"),
            ("stock_transfer_lines", "product_id"),
        ]
        for table, column in checks:
            exists = cur.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_schema = 'food_cost' AND table_name = %s",
                (table,),
            ).fetchone()
            if not exists:
                continue
            count = cur.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {column}=%s", (product_id,)
            ).fetchone()[0]
            if count:
                return False
        return True


def get_invoice_repo(db: DBConnection = Depends(get_db)) -> InvoiceRepository:
    return InvoiceRepository(db)
