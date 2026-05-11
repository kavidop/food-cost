from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection


_SORT_COLS = {
    "name":     "p.name",
    "sku":      "ps.supplier_sku",
    "category": "pc.name",
    "price":    "ps.current_price",
}


class ProductRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def create_product(
        self,
        name: str,
        description: str | None,
        category_id: int | None,
        unit_id: int | None,
        volume_ml: float | None,
        abv_percent: float | None,
        units_per_pack: float | None,
        pack_unit_id: int | None,
        pack_unit_size_ml: float | None,
        supplier_id: int | None = None,
        supplier_sku: str | None = None,
        current_price: float | None = None,
    ) -> int:
        cur = self.db.cursor()
        cur.execute("""
            INSERT INTO products
                (name, description, category_id, unit_id, volume_ml, abv_percent,
                 units_per_pack, pack_unit_id, pack_unit_size_ml, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
        """, (name, description, category_id, unit_id, volume_ml, abv_percent,
              units_per_pack, pack_unit_id, pack_unit_size_ml))
        product_id = cur.lastrowid

        if supplier_id:
            cur.execute("""
                INSERT INTO supplier_products (supplier_id, product_id, supplier_sku, current_price)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (supplier_id, supplier_sku) DO NOTHING
            """, (supplier_id, product_id, supplier_sku, current_price))

        self.db.commit()
        return product_id

    def list_all(self, exclude_category_id: int | None = None) -> list[dict]:
        where = ""
        params: list = []
        if exclude_category_id is not None:
            where = "WHERE p.category_id != %s OR p.category_id IS NULL"
            params = [exclude_category_id]
        rows = self.db.execute(f"""
            SELECT p.id, p.name,
                   COALESCE(p.units_per_pack, 1) AS units_per_pack,
                   uom.abbreviation              AS unit,
                   COALESCE(
                       (SELECT MIN(sp.current_price)
                        FROM supplier_products sp WHERE sp.product_id = p.id
                        AND sp.current_price IS NOT NULL), 0
                   ) AS current_price
            FROM products p
            LEFT JOIN units_of_measure uom ON uom.id = p.unit_id
            {where}
            ORDER BY p.name
        """, params if params else None).fetchall()
        return [dict(r) for r in rows]

    def get_product(self, product_id: int) -> dict | None:
        row = self.db.execute("""
            WITH preferred_supplier AS (
                SELECT DISTINCT ON (sp.product_id)
                    sp.product_id, sp.id AS supplier_product_id, sp.supplier_sku,
                    sp.current_price, sp.total_quantity_ordered,
                    COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier
                FROM supplier_products sp
                LEFT JOIN suppliers s ON s.id = sp.supplier_id
                ORDER BY sp.product_id, sp.is_preferred_supplier DESC, sp.current_price ASC
            )
            SELECT p.id, p.name, p.description, p.volume_ml, p.abv_percent,
                   p.units_per_pack, p.pack_unit_size_ml,
                   p.category_id,
                   pc.name                    AS category,
                   p.unit_id,
                   uom.abbreviation           AS unit,
                   p.pack_unit_id,
                   puom.abbreviation          AS pack_unit,
                   ps.supplier,
                   ps.supplier_product_id,
                   ps.supplier_sku, ps.current_price, ps.total_quantity_ordered
            FROM products p
            LEFT JOIN preferred_supplier ps ON ps.product_id = p.id
            LEFT JOIN product_categories pc   ON pc.id  = p.category_id
            LEFT JOIN units_of_measure uom    ON uom.id = p.unit_id
            LEFT JOIN units_of_measure puom   ON puom.id = p.pack_unit_id
            WHERE p.id = %s
        """, (product_id,)).fetchone()
        return dict(row) if row else None

    def search(
        self,
        q: str = "",
        category_id: str = "",
        supplier_id: str = "",
        page: int = 1,
        sort_by: str = "name",
        sort_dir: str = "asc",
    ) -> dict:
        per_page  = 25
        offset    = (page - 1) * per_page
        order_col = _SORT_COLS.get(sort_by, "p.name")
        direction = "DESC" if sort_dir.lower() == "desc" else "ASC"

        where:  list[str] = ["1=1"]
        params: list      = []

        if q:
            where.append(
                "(p.name ILIKE %s OR p.description ILIKE %s OR"
                " EXISTS (SELECT 1 FROM supplier_products sp_sku"
                "  WHERE sp_sku.product_id = p.id AND sp_sku.supplier_sku ILIKE %s))"
            )
            params += [f"%{q}%", f"%{q}%", f"%{q}%"]
        if category_id:
            where.append("p.category_id = %s")
            params.append(category_id)

        sql_where = " AND ".join(where)

        # --- Count (no JOIN needed — uses EXISTS for supplier filter) ---
        count_where = list(where)
        count_params = list(params)
        if supplier_id:
            count_where.append(
                "EXISTS (SELECT 1 FROM supplier_products sp"
                " WHERE sp.product_id = p.id AND sp.supplier_id = %s)"
            )
            count_params.append(supplier_id)

        total = self.db.execute(
            f"SELECT COUNT(*) FROM products p WHERE {' AND '.join(count_where)}",
            count_params if count_params else None,
        ).fetchone()[0]

        # --- Supplier CTE (DISTINCT ON picks one preferred/cheapest supplier per product) ---
        cte_where = ""
        cte_params: list = []
        if supplier_id:
            cte_where = "WHERE sp.supplier_id = %s"
            cte_params = [supplier_id]
            where.append("ps.supplier_product_id IS NOT NULL")
            sql_where = " AND ".join(where)

        rows = self.db.execute(f"""
            WITH preferred_supplier AS (
                SELECT DISTINCT ON (sp.product_id)
                    sp.product_id, sp.id AS supplier_product_id, sp.supplier_sku,
                    sp.current_price, sp.total_quantity_ordered,
                    COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier
                FROM supplier_products sp
                LEFT JOIN suppliers s ON s.id = sp.supplier_id
                {cte_where}
                ORDER BY sp.product_id, sp.is_preferred_supplier DESC, sp.current_price ASC
            )
            SELECT p.id, p.name, p.description, p.volume_ml, p.abv_percent,
                   p.units_per_pack, p.pack_unit_size_ml,
                   p.category_id,
                   pc.name                    AS category,
                   p.unit_id,
                   uom.abbreviation           AS unit,
                   p.pack_unit_id,
                   puom.abbreviation          AS pack_unit,
                   ps.supplier,
                   ps.supplier_product_id,
                   ps.supplier_sku, ps.current_price, ps.total_quantity_ordered
            FROM products p
            LEFT JOIN preferred_supplier ps ON ps.product_id = p.id
            LEFT JOIN product_categories pc   ON pc.id  = p.category_id
            LEFT JOIN units_of_measure uom    ON uom.id = p.unit_id
            LEFT JOIN units_of_measure puom   ON puom.id = p.pack_unit_id
            WHERE {sql_where}
            ORDER BY {order_col} {direction} NULLS LAST
            LIMIT %s OFFSET %s
        """, (cte_params + params + [per_page, offset]) if cte_params or params else [per_page, offset]).fetchall()

        return {
            "products":  [dict(r) for r in rows],
            "total":     total,
            "page":      page,
            "per_page":  per_page,
            "sort_by":   sort_by,
            "sort_dir":  direction.lower(),
        }

    def get_product_invoices(self, product_id: int) -> list[dict]:
        rows = self.db.execute("""
            SELECT i.id, i.invoice_number, i.invoice_date,
                   COALESCE(NULLIF(s.trade_name,''), s.name) AS supplier_name,
                   il.quantity,
                   uom.abbreviation AS unit,
                   il.unit_price, il.discount_percent,
                   il.line_net_amount, il.line_gross_amount
            FROM invoice_lines il
            JOIN invoices i  ON i.id = il.invoice_id
            JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
            WHERE il.supplier_product_id IN (
                SELECT id FROM supplier_products WHERE product_id = %s
            )
            ORDER BY i.invoice_date DESC, i.id DESC
        """, (product_id,)).fetchall()
        return [dict(r) for r in rows]

    def update_product(
        self,
        product_id: int,
        name: str,
        description: str | None,
        category_id: int | None,
        unit_id: int | None,
        volume_ml: float | None,
        abv_percent: float | None,
        units_per_pack: float | None,
        pack_unit_id: int | None,
        pack_unit_size_ml: float | None,
        supplier_product_id: int | None,
        supplier_sku: str | None,
    ) -> None:
        cur = self.db.cursor()
        cur.execute("""
            UPDATE products
            SET name=%s, description=%s, category_id=%s, unit_id=%s,
                volume_ml=%s, abv_percent=%s, units_per_pack=%s,
                pack_unit_id=%s, pack_unit_size_ml=%s
            WHERE id=%s
        """, (name, description, category_id, unit_id,
              volume_ml, abv_percent, units_per_pack,
              pack_unit_id, pack_unit_size_ml, product_id))

        if supplier_product_id and supplier_sku is not None:
            cur.execute(
                "UPDATE supplier_products SET supplier_sku=%s WHERE id=%s",
                (supplier_sku, supplier_product_id),
            )
        self.db.commit()

    def merge_products(self, source_id: int, target_id: int) -> None:
        if source_id == target_id:
            raise ValueError("Cannot merge a product with itself")
        cur = self.db.cursor()
        if not cur.execute("SELECT id FROM products WHERE id=%s", (source_id,)).fetchone():
            raise ValueError(f"Source product {source_id} not found")
        if not cur.execute("SELECT id FROM products WHERE id=%s", (target_id,)).fetchone():
            raise ValueError(f"Target product {target_id} not found")

        # 1. Merge supplier_products: average prices, sum ordered qty
        for sp in cur.execute(
            "SELECT id, supplier_id, current_price, total_quantity_ordered "
            "FROM supplier_products WHERE product_id=%s",
            (source_id,),
        ).fetchall():
            tgt_sp = cur.execute(
                "SELECT id, current_price, total_quantity_ordered "
                "FROM supplier_products WHERE product_id=%s AND supplier_id=%s",
                (target_id, sp["supplier_id"]),
            ).fetchone()
            if tgt_sp:
                sp_price, tgt_price = sp["current_price"] or 0, tgt_sp["current_price"] or 0
                avg_price = (sp_price + tgt_price) / 2 if sp_price and tgt_price else (sp_price or tgt_price)
                cur.execute(
                    "UPDATE supplier_products SET current_price=%s, "
                    "total_quantity_ordered=%s, updated_at=NOW() WHERE id=%s",
                    (avg_price, (sp["total_quantity_ordered"] or 0) + (tgt_sp["total_quantity_ordered"] or 0), tgt_sp["id"]),
                )
                cur.execute("UPDATE invoice_lines SET supplier_product_id=%s WHERE supplier_product_id=%s", (tgt_sp["id"], sp["id"]))
                cur.execute("UPDATE price_history SET supplier_product_id=%s WHERE supplier_product_id=%s", (tgt_sp["id"], sp["id"]))
                cur.execute("DELETE FROM supplier_products WHERE id=%s", (sp["id"],))
            else:
                cur.execute(
                    "UPDATE supplier_products SET product_id=%s, updated_at=NOW() WHERE id=%s",
                    (target_id, sp["id"]),
                )

        # 2. Move all stock movements to target
        cur.execute("UPDATE stock_movements SET product_id=%s WHERE product_id=%s", (target_id, source_id))

        # 3. Rebuild inventory balances for target (source balances already moved via stock_movements)
        cur.execute("DELETE FROM inventory_balances WHERE product_id IN (%s, %s)", (source_id, target_id))
        cur.execute("""
            INSERT INTO inventory_balances (product_id, location_id, quantity, unit_id)
            SELECT product_id, location_id, ROUND(SUM(quantity)::numeric, 6), MIN(unit_id)
            FROM stock_movements WHERE product_id=%s
            GROUP BY product_id, location_id
            HAVING ABS(SUM(quantity)) > 0.0000001
        """, (target_id,))

        # 4. Composite recipe components — skip if target already appears in same recipe
        existing_recipes = {
            r["composite_product_id"] for r in cur.execute(
                "SELECT composite_product_id FROM composite_product_components WHERE component_product_id=%s",
                (target_id,),
            ).fetchall()
        }
        for comp in cur.execute(
            "SELECT id, composite_product_id FROM composite_product_components WHERE component_product_id=%s",
            (source_id,),
        ).fetchall():
            if comp["composite_product_id"] not in existing_recipes:
                cur.execute("UPDATE composite_product_components SET component_product_id=%s WHERE id=%s", (target_id, comp["id"]))
            else:
                cur.execute("DELETE FROM composite_product_components WHERE id=%s", (comp["id"],))

        # 5. Recipe yields, unit conversions, transfer lines
        cur.execute("UPDATE recipe_yields SET yield_product_id=%s WHERE yield_product_id=%s", (target_id, source_id))
        cur.execute("UPDATE unit_conversions SET product_id=%s WHERE product_id=%s", (target_id, source_id))
        cur.execute("UPDATE stock_transfer_lines SET product_id=%s WHERE product_id=%s", (target_id, source_id))

        # 6. Stock count lines — skip if target already in same session (UNIQUE constraint)
        existing_sessions = {
            r["session_id"] for r in cur.execute(
                "SELECT session_id FROM stock_count_lines WHERE product_id=%s", (target_id,)
            ).fetchall()
        }
        for line in cur.execute(
            "SELECT id, session_id FROM stock_count_lines WHERE product_id=%s", (source_id,)
        ).fetchall():
            if line["session_id"] not in existing_sessions:
                cur.execute("UPDATE stock_count_lines SET product_id=%s WHERE id=%s", (target_id, line["id"]))
            else:
                cur.execute("DELETE FROM stock_count_lines WHERE id=%s", (line["id"],))

        # 7. Delete source product
        cur.execute("DELETE FROM products WHERE id=%s", (source_id,))
        self.db.commit()

    def list_categories(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT id, name, parent_id FROM product_categories ORDER BY name"
        ).fetchall()
        return [dict(r) for r in rows]

    def create_category(self, name: str, parent_id: int | None) -> dict:
        existing = self.db.execute(
            "SELECT id FROM product_categories WHERE lower(name) = lower(%s)", (name,)
        ).fetchone()
        if existing:
            raise ValueError(f"A category named '{name}' already exists")
        cur = self.db.cursor()
        cur.execute(
            "INSERT INTO product_categories (name, parent_id) VALUES (%s, %s)",
            (name, parent_id),
        )
        self.db.commit()
        return {"id": cur.lastrowid, "name": name, "parent_id": parent_id}

    def update_category(self, cat_id: int, name: str, parent_id: int | None) -> None:
        existing = self.db.execute(
            "SELECT id FROM product_categories WHERE lower(name) = lower(%s) AND id != %s",
            (name, cat_id),
        ).fetchone()
        if existing:
            raise ValueError(f"A category named '{name}' already exists")
        self.db.execute(
            "UPDATE product_categories SET name=%s, parent_id=%s WHERE id=%s",
            (name, parent_id, cat_id),
        )
        self.db.commit()

    def delete_category(self, cat_id: int) -> None:
        prod_cnt = self.db.execute(
            "SELECT COUNT(*) FROM products WHERE category_id=%s", (cat_id,)
        ).fetchone()[0]
        if prod_cnt:
            raise ValueError(f"Cannot delete: {prod_cnt} product(s) assigned to this category")

        sub_cnt = self.db.execute(
            "SELECT COUNT(*) FROM product_categories WHERE parent_id=%s", (cat_id,)
        ).fetchone()[0]
        if sub_cnt:
            raise ValueError(
                f"Cannot delete: {sub_cnt} sub-categor{'ies' if sub_cnt > 1 else 'y'} exist"
            )

        self.db.execute("DELETE FROM product_categories WHERE id=%s", (cat_id,))
        self.db.commit()

    def get_catalog_stats(self) -> dict:
        # Compute stock value per-product with proper unit normalisation
        cost_rows = [dict(r) for r in self.db.execute("""
            SELECT
                p.id,
                p.units_per_pack,
                COALESCE(SUM(ib.quantity), 0) AS on_hand_qty,
                COALESCE((
                    SELECT ROUND((SUM(il.quantity * il.unit_price) / NULLIF(SUM(il.quantity), 0))::numeric, 4)
                    FROM invoice_lines il
                    JOIN supplier_products sp ON sp.id = il.supplier_product_id
                    WHERE sp.product_id = p.id AND il.quantity > 0
                ), (
                    SELECT ph.unit_price
                    FROM price_history ph
                    JOIN supplier_products sp ON sp.id = ph.supplier_product_id
                    WHERE sp.product_id = p.id
                    ORDER BY ph.effective_from DESC, ph.id DESC LIMIT 1
                ), (
                    SELECT sp.current_price
                    FROM supplier_products sp
                    WHERE sp.product_id = p.id
                    ORDER BY sp.is_preferred_supplier DESC, sp.current_price ASC LIMIT 1
                )) AS cost
            FROM products p
            LEFT JOIN inventory_balances ib ON ib.product_id = p.id
            WHERE p.is_active = 1
            GROUP BY p.id, p.units_per_pack
        """).fetchall()]

        stock_value = 0.0
        for r in cost_rows:
            qty = r["on_hand_qty"] or 0.0
            cost = r["cost"]
            upp = r["units_per_pack"]
            if cost and qty > 0:
                pack_qty = qty / upp if upp and upp > 1 else qty
                stock_value += pack_qty * cost

        row = self.db.execute("""
            WITH pending AS (
                SELECT COUNT(*) AS cnt
                FROM stock_movements sm
                WHERE sm.movement_type = 'receipt_pending'
                  AND sm.reference_id IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM stock_movements sv
                      WHERE sv.reference_type = 'void' AND sv.reference_id = sm.id
                  )
            )
            SELECT
                COUNT(*)::int AS total_active,
                SUM(CASE WHEN p.min_stock_level IS NOT NULL
                              AND COALESCE(b.on_hand, 0) > 0
                              AND COALESCE(b.on_hand, 0) < p.min_stock_level
                         THEN 1 ELSE 0 END)::int AS low_stock,
                SUM(CASE WHEN COALESCE(b.on_hand, 0) <= 0 THEN 1 ELSE 0 END)::int AS out_of_stock,
                (SELECT cnt FROM pending)::int AS pending_receipts
            FROM products p
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS on_hand
                FROM inventory_balances
                GROUP BY product_id
            ) b ON b.product_id = p.id
        """).fetchone()
        r = dict(row) if row else {}
        return {
            "total_active":    r.get("total_active", 0),
            "missing_cost":    sum(1 for cr in cost_rows if cr["cost"] is None and (cr["on_hand_qty"] or 0) > 0),
            "low_stock":       r.get("low_stock", 0),
            "out_of_stock":    r.get("out_of_stock", 0),
            "stock_value":     round(stock_value, 2),
            "pending_receipts": r.get("pending_receipts", 0),
        }

    def get_main_category_breakdown(self) -> list[dict]:
        rows = self.db.execute("""
            WITH RECURSIVE cat_root AS (
                SELECT id, name AS root_name, id AS root_id
                FROM product_categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, cr.root_name, cr.root_id
                FROM product_categories c
                JOIN cat_root cr ON cr.id = c.parent_id
            ),
            inv AS (
                SELECT p.id AS product_id, cr.root_id, cr.root_name,
                       p.units_per_pack,
                       COALESCE(SUM(ib.quantity), 0) AS qty,
                       COALESCE((
                           SELECT ROUND((SUM(il.quantity * il.unit_price) / NULLIF(SUM(il.quantity),0))::numeric,4)
                           FROM invoice_lines il
                           JOIN supplier_products sp ON sp.id = il.supplier_product_id
                           WHERE sp.product_id = p.id AND il.quantity > 0
                       ), (
                           SELECT sp2.current_price FROM supplier_products sp2
                           WHERE sp2.product_id = p.id
                           ORDER BY sp2.is_preferred_supplier DESC, sp2.current_price ASC LIMIT 1
                       )) AS cost,
                       COALESCE(SUM(ib.quantity), 0) AS on_hand,
                       p.min_stock_level
                FROM cat_root cr
                JOIN products p ON p.category_id = cr.id AND p.is_active = 1
                LEFT JOIN inventory_balances ib ON ib.product_id = p.id
                GROUP BY p.id, cr.root_id, cr.root_name, p.units_per_pack, p.min_stock_level
            ),
            spend AS (
                SELECT cr.root_id,
                       ROUND(COALESCE(SUM(
                           CASE WHEN i.invoice_type = 'invoice' THEN il.line_gross_amount
                                ELSE -il.line_gross_amount END
                       ), 0)::numeric, 2) AS total_spend
                FROM cat_root cr
                JOIN products p ON p.category_id = cr.id
                JOIN supplier_products sp ON sp.product_id = p.id
                JOIN invoice_lines il ON il.supplier_product_id = sp.id
                JOIN invoices i ON i.id = il.invoice_id
                GROUP BY cr.root_id
            )
            SELECT
                i.root_id AS id,
                i.root_name AS name,
                COUNT(DISTINCT i.product_id) AS product_count,
                ROUND(SUM(
                    CASE WHEN i.units_per_pack > 1 THEN i.qty / i.units_per_pack ELSE i.qty END
                    * COALESCE(i.cost, 0)
                )::numeric, 2) AS stock_value,
                COALESCE(s.total_spend, 0) AS total_spend,
                SUM(CASE WHEN i.on_hand > 0 AND i.min_stock_level IS NOT NULL
                              AND i.on_hand <= i.min_stock_level THEN 1 ELSE 0 END) AS low_stock,
                SUM(CASE WHEN i.on_hand <= 0 THEN 1 ELSE 0 END) AS out_of_stock
            FROM inv i
            LEFT JOIN spend s ON s.root_id = i.root_id
            GROUP BY i.root_id, i.root_name, s.total_spend
            ORDER BY i.root_name
        """).fetchall()
        return [dict(r) for r in rows]

    def get_product_cost_history(self, product_id: int) -> list[dict]:
        rows = self.db.execute("""
            SELECT
                i.invoice_date::text                         AS invoice_date,
                i.invoice_number,
                COALESCE(NULLIF(s.trade_name,''), s.name)    AS supplier_name,
                ROUND(il.quantity::numeric, 4)               AS quantity,
                uom.abbreviation                             AS unit,
                ROUND(il.unit_price::numeric, 4)             AS unit_price,
                ROUND(il.discount_percent::numeric, 2)       AS discount_percent,
                ROUND(il.line_net_amount::numeric, 2)        AS line_net_amount,
                ROUND(il.line_gross_amount::numeric, 2)      AS line_gross_amount
            FROM invoice_lines il
            JOIN invoices i ON i.id = il.invoice_id
            JOIN supplier_products sp ON sp.id = il.supplier_product_id
            JOIN suppliers s ON s.id = sp.supplier_id
            LEFT JOIN units_of_measure uom ON uom.id = il.unit_id
            WHERE sp.product_id = %s
              AND i.invoice_type = 'invoice'
            ORDER BY i.invoice_date ASC, i.id ASC
        """, (product_id,)).fetchall()
        return [dict(r) for r in rows]

    def list_units(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT id, name, abbreviation FROM units_of_measure ORDER BY name"
        ).fetchall()
        return [dict(r) for r in rows]


def get_product_repo(db: DBConnection = Depends(get_db)) -> ProductRepository:
    return ProductRepository(db)
