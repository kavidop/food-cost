from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection


class SupplierRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_suppliers(self) -> list[dict]:
        rows = self.db.execute("""
            SELECT s.id, s.name, s.trade_name, s.vat_number, s.phone, s.email, s.is_active,
                   (SELECT COUNT(*) FROM invoices WHERE supplier_id = s.id) AS invoice_count,
                   (
                       SELECT COALESCE(SUM(CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount ELSE -il.line_gross_amount END), 0)
                       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                       WHERE i.supplier_id = s.id
                   ) AS total_spend,
                   (SELECT COUNT(DISTINCT product_id) FROM supplier_products WHERE supplier_id = s.id) AS product_count,
                   (
                       SELECT pc.name
                       FROM supplier_products sp2
                       JOIN products p2           ON p2.id  = sp2.product_id
                       JOIN product_categories pc ON pc.id  = p2.category_id
                       WHERE sp2.supplier_id = s.id AND p2.category_id IS NOT NULL
                       GROUP BY p2.category_id, pc.name ORDER BY COUNT(*) DESC LIMIT 1
                   ) AS primary_category
            FROM suppliers s
            ORDER BY s.name
        """).fetchall()
        return [dict(r) for r in rows]

    def get_supplier(self, supplier_id: int) -> dict | None:
        row = self.db.execute("SELECT * FROM suppliers WHERE id=%s", (supplier_id,)).fetchone()
        if not row:
            return None

        supplier = dict(row)

        inv_stats = self.db.execute("""
            SELECT COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount ELSE -il.line_gross_amount END), 0) AS total_spend,
                   COALESCE(SUM(CASE WHEN i.invoice_type = 'invoice' THEN il.line_net_amount   ELSE -il.line_net_amount   END), 0) AS total_net,
                   COALESCE(SUM(CASE WHEN i.invoice_type = 'invoice'
                                     THEN il.line_gross_amount - il.line_net_amount
                                     ELSE -(il.line_gross_amount - il.line_net_amount) END), 0) AS total_vat
            FROM invoices i
            JOIN invoice_lines il ON il.invoice_id = i.id
            WHERE i.supplier_id=%s
        """, (supplier_id,)).fetchone()

        prod_count = self.db.execute(
            "SELECT COUNT(DISTINCT product_id) FROM supplier_products WHERE supplier_id=%s",
            (supplier_id,),
        ).fetchone()[0]

        stats = dict(inv_stats)
        stats["product_count"] = prod_count
        supplier["stats"] = stats

        supplier["invoices"] = [dict(r) for r in self.db.execute("""
            SELECT i.id, i.invoice_number, i.invoice_date, i.status, i.invoice_type,
                   i.net_amount, i.vat_amount, i.gross_amount,
                   COUNT(il.id) AS line_count
            FROM invoices i LEFT JOIN invoice_lines il ON il.invoice_id = i.id
            WHERE i.supplier_id=%s
            GROUP BY i.id, i.invoice_number, i.invoice_date, i.status, i.invoice_type,
                     i.net_amount, i.vat_amount, i.gross_amount
            ORDER BY i.invoice_date DESC
        """, (supplier_id,)).fetchall()]

        supplier["products"] = [dict(r) for r in self.db.execute("""
            SELECT p.id, p.name, uom.abbreviation AS unit,
                   pc.name AS category,
                   sp.id AS supplier_product_id, sp.supplier_sku,
                   sp.current_price, sp.total_quantity_ordered
            FROM supplier_products sp
            JOIN products p ON p.id = sp.product_id
            LEFT JOIN units_of_measure uom  ON uom.id = p.unit_id
            LEFT JOIN product_categories pc ON pc.id  = p.category_id
            WHERE sp.supplier_id=%s
            ORDER BY p.name
        """, (supplier_id,)).fetchall()]

        return supplier

    def update_supplier(
        self,
        supplier_id: int,
        name: str,
        trade_name: str | None,
        vat_number: str | None,
        phone: str | None,
        email: str | None,
        address: str | None,
    ) -> None:
        self.db.execute("""
            UPDATE suppliers
            SET name=%s, trade_name=%s, vat_number=%s, phone=%s, email=%s, address=%s
            WHERE id=%s
        """, (name, trade_name, vat_number, phone, email, address, supplier_id))
        self.db.commit()

    def delete_supplier(self, supplier_id: int) -> None:
        inv_cnt = self.db.execute(
            "SELECT COUNT(*) FROM invoices WHERE supplier_id=%s", (supplier_id,)
        ).fetchone()[0]
        if inv_cnt:
            raise ValueError(f"Supplier has {inv_cnt} invoice(s) — merge first.")

        sp_cnt = self.db.execute(
            "SELECT COUNT(*) FROM supplier_products WHERE supplier_id=%s", (supplier_id,)
        ).fetchone()[0]
        if sp_cnt:
            raise ValueError(f"Supplier has {sp_cnt} product(s) — merge first.")

        self.db.execute("DELETE FROM suppliers WHERE id=%s", (supplier_id,))
        self.db.commit()

    def merge_suppliers(self, supplier_id: int, target_id: int) -> None:
        self.db.execute(
            "UPDATE invoices SET supplier_id=%s WHERE supplier_id=%s", (target_id, supplier_id)
        )
        self.db.execute(
            "UPDATE supplier_products SET supplier_id=%s WHERE supplier_id=%s", (target_id, supplier_id)
        )
        self.db.execute("DELETE FROM suppliers WHERE id=%s", (supplier_id,))
        self.db.commit()


def get_supplier_repo(db: DBConnection = Depends(get_db)) -> SupplierRepository:
    return SupplierRepository(db)
