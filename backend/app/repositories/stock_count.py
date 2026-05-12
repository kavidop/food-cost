import csv
import io

from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class StockCountRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_sessions(self, location_id: int | None = None) -> dict:
        where = ["1=1"]
        params: list = []
        if location_id:
            where.append("s.location_id = %s")
            params.append(location_id)

        rows = self.db.execute(f"""
            SELECT
                s.id, s.location_id, sl.name AS location_name,
                s.count_date, s.counted_at, s.frozen_at, s.notes, s.status,
                COUNT(l.id)                                         AS line_count,
                COUNT(CASE WHEN l.counted_qty IS NOT NULL THEN 1 END) AS counted_lines,
                COUNT(CASE WHEN l.counted_qty IS NOT NULL
                            AND ABS(l.counted_qty - COALESCE(l.system_qty, 0)) > 0.0001
                           THEN 1 END)                              AS total_variance_items
            FROM stock_count_sessions s
            JOIN stock_locations sl ON sl.id = s.location_id
            LEFT JOIN stock_count_lines l ON l.session_id = s.id
            WHERE {' AND '.join(where)}
            GROUP BY s.id, s.location_id, sl.name, s.count_date, s.counted_at, s.frozen_at, s.notes, s.status
            ORDER BY s.counted_at DESC
        """, params).fetchall()

        return {
            "sessions": [dict(r) for r in rows],
            "total": len(rows),
        }

    def create_session(self, location_id: int, notes: str | None) -> dict:
        cur = self.db.execute("""
            INSERT INTO stock_count_sessions (location_id, notes, frozen_at, count_date)
            VALUES (%s, %s, NOW(), CURRENT_DATE)
        """, (location_id, notes))
        session_id = cur.lastrowid

        self.db.execute("""
            INSERT INTO stock_count_lines (session_id, product_id, system_qty, unit_id)
            SELECT %s, ib.product_id, ib.quantity, ib.unit_id
            FROM inventory_balances ib
            JOIN products p ON p.id = ib.product_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            WHERE ib.location_id = %s
              AND COALESCE(pc.is_service, FALSE) = FALSE
            ON CONFLICT (session_id, product_id) DO NOTHING
        """, (session_id, location_id))

        self.db.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: int) -> dict | None:
        session = self._get_session_row(session_id)
        if not session:
            return None

        lines = self.db.execute("""
            SELECT
                l.id, l.product_id, p.name AS product_name,
                uom.abbreviation AS unit,
                l.system_qty, l.counted_qty, l.notes,
                p.category_id,
                pc.name AS category_name
            FROM stock_count_lines l
            JOIN products p ON p.id = l.product_id
            LEFT JOIN units_of_measure uom ON uom.id = l.unit_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            WHERE l.session_id = %s
              AND COALESCE(pc.is_service, FALSE) = FALSE
            ORDER BY p.name
        """, (session_id,)).fetchall()

        result_lines = []
        for r in lines:
            row = dict(r)
            if row["counted_qty"] is not None and row["system_qty"] is not None:
                row["variance"] = round(row["counted_qty"] - row["system_qty"], 4)
            else:
                row["variance"] = None
            result_lines.append(row)

        session["lines"] = result_lines
        session["categories"] = self.get_count_categories(session_id)
        return session

    def update_lines(self, session_id: int, lines: list[dict]) -> None:
        for line in lines:
            self.db.execute("""
                UPDATE stock_count_lines
                SET counted_qty = %s, notes = %s
                WHERE session_id = %s AND product_id = %s
            """, (line["counted_qty"], line.get("notes"), session_id, line["product_id"]))
        self.db.commit()

    def refresh_lines(self, session_id: int) -> dict | None:
        """Re-sync system_qty from current inventory_balances for a draft session.
        New products (e.g. transferred in after session creation) are added.
        Existing lines get updated system_qty; counted_qty and notes are preserved.
        """
        session = self._get_session_row(session_id)
        if not session or session["status"] != "draft":
            return None

        self.db.execute("""
            INSERT INTO stock_count_lines (session_id, product_id, system_qty, unit_id)
            SELECT %s, ib.product_id, ib.quantity, ib.unit_id
            FROM inventory_balances ib
            JOIN products p ON p.id = ib.product_id
            LEFT JOIN product_categories pc ON pc.id = p.category_id
            WHERE ib.location_id = %s
              AND COALESCE(pc.is_service, FALSE) = FALSE
            ON CONFLICT (session_id, product_id) DO UPDATE SET
                system_qty = EXCLUDED.system_qty,
                unit_id    = EXCLUDED.unit_id
        """, (session_id, session["location_id"]))

        self.db.execute(
            "UPDATE stock_count_sessions SET frozen_at = NOW() WHERE id = %s",
            (session_id,),
        )
        self.db.commit()
        return self.get_session(session_id)

    def submit_for_approval(self, session_id: int) -> dict | None:
        session = self._get_session_row(session_id)
        if not session or session["status"] != "draft":
            return None
        self.db.execute(
            "UPDATE stock_count_sessions SET status = 'pending_approval' WHERE id = %s",
            (session_id,),
        )
        self.db.commit()
        return self._get_session_row(session_id)

    def approve_and_post(self, session_id: int) -> dict | None:
        session = self._get_session_row(session_id)
        if not session or session["status"] != "pending_approval":
            return None

        lines = self.db.execute("""
            SELECT l.product_id, l.system_qty, l.counted_qty, l.unit_id
            FROM stock_count_lines l
            WHERE l.session_id = %s AND l.counted_qty IS NOT NULL
        """, (session_id,)).fetchall()

        movements_created = 0
        postings: list[dict] = []
        for line in lines:
            system_qty  = line["system_qty"] or 0.0
            counted_qty = line["counted_qty"]
            delta       = round(counted_qty - system_qty, 6)
            if abs(delta) < 0.0001:
                continue

            location_id = session["location_id"]
            postings.append({
                "product_id": line["product_id"],
                "location_id": location_id,
                "movement_type": "count_reconciliation",
                "quantity": delta,
                "unit_id": line["unit_id"],
                "reference_type": "stock_count",
                "reference_id": session_id,
                "notes": f"Count reconciliation — session #{session_id}",
            })
            movements_created += 1

        result = post_movements(self.db, postings, commit=False)
        if not result["success"]:
            return None

        self.db.execute(
            "UPDATE stock_count_sessions SET status = 'committed' WHERE id = %s",
            (session_id,),
        )
        self.db.commit()

        return {
            "success": True,
            "movements_created": movements_created,
            "session_id": session_id,
        }

    def export_session_csv(self, session_id: int) -> str:
        rows = self.db.execute("""
            SELECT
                p.name AS product_name,
                uom.abbreviation AS unit,
                l.system_qty, l.counted_qty,
                CASE WHEN l.counted_qty IS NOT NULL
                     THEN round((l.counted_qty - COALESCE(l.system_qty, 0))::numeric, 4)
                     ELSE NULL END AS variance,
                l.notes
            FROM stock_count_lines l
            JOIN products p ON p.id = l.product_id
            LEFT JOIN units_of_measure uom ON uom.id = l.unit_id
            WHERE l.session_id = %s
            ORDER BY p.name
        """, (session_id,)).fetchall()

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=[
            "product_name", "unit", "system_qty", "counted_qty", "variance", "notes",
        ], extrasaction="ignore")
        writer.writeheader()
        writer.writerows([dict(r) for r in rows])
        return buf.getvalue()

    def delete_line(self, session_id: int, product_id: int) -> str | None:
        """Remove a line from a draft session. Returns an error string or None on success."""
        session = self._get_session_row(session_id)
        if not session or session["status"] != "draft":
            return "Session not found or not in draft status"
        line = self.db.execute(
            "SELECT system_qty FROM stock_count_lines WHERE session_id = %s AND product_id = %s",
            (session_id, product_id),
        ).fetchone()
        if not line:
            return "Line not found"
        if line["system_qty"] is not None and abs(line["system_qty"]) > 0.0001:
            return "Can only remove lines with zero system quantity"
        self.db.execute(
            "DELETE FROM stock_count_lines WHERE session_id = %s AND product_id = %s",
            (session_id, product_id),
        )
        self.db.commit()
        return None

    def update_count_date(self, session_id: int, count_date) -> None:
        self.db.execute(
            "UPDATE stock_count_sessions SET count_date = %s WHERE id = %s",
            (count_date, session_id),
        )
        self.db.commit()

    def get_count_categories(self, session_id: int) -> list[dict]:
        rows = self.db.execute("""
            SELECT n.id, n.session_id, n.category_id, pc.name AS category_name, n.display_order
            FROM stock_count_category_nodes n
            JOIN product_categories pc ON pc.id = n.category_id
            WHERE n.session_id = %s
            ORDER BY n.display_order, pc.name
        """, (session_id,)).fetchall()
        return [dict(r) for r in rows]

    def set_count_categories(self, session_id: int, category_ids: list[int]) -> None:
        self.db.execute(
            "DELETE FROM stock_count_category_nodes WHERE session_id = %s",
            (session_id,),
        )
        for i, cat_id in enumerate(category_ids):
            self.db.execute("""
                INSERT INTO stock_count_category_nodes (session_id, category_id, display_order)
                VALUES (%s, %s, %s)
            """, (session_id, cat_id, i))
        self.db.commit()

    def _get_session_row(self, session_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT
                s.id, s.location_id, sl.name AS location_name,
                s.count_date, s.counted_at, s.frozen_at, s.notes, s.status,
                COUNT(l.id)                                           AS line_count,
                COUNT(CASE WHEN l.counted_qty IS NOT NULL THEN 1 END) AS counted_lines,
                COUNT(CASE WHEN l.counted_qty IS NOT NULL
                            AND ABS(l.counted_qty - COALESCE(l.system_qty, 0)) > 0.0001
                           THEN 1 END)                                AS total_variance_items
            FROM stock_count_sessions s
            JOIN stock_locations sl ON sl.id = s.location_id
            LEFT JOIN stock_count_lines l ON l.session_id = s.id
            WHERE s.id = %s
            GROUP BY s.id, s.location_id, sl.name, s.count_date, s.counted_at, s.frozen_at, s.notes, s.status
        """, (session_id,)).fetchone()
        return dict(row) if row else None


def get_stock_count_repo(db: DBConnection = Depends(get_db)) -> StockCountRepository:
    return StockCountRepository(db)
