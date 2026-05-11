from fastapi import Depends

from ..database import get_db
from ..protocols import DBConnection
from ..services.inventory_posting_service import post_movements


class TransfersRepository:
    def __init__(self, db: DBConnection) -> None:
        self.db = db

    def list_transfers(
        self,
        from_location_id: int | None = None,
        to_location_id: int | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        where = ["1=1"]
        params: list = []
        if from_location_id:
            where.append("t.from_location_id = %s")
            params.append(from_location_id)
        if to_location_id:
            where.append("t.to_location_id = %s")
            params.append(to_location_id)
        if status:
            where.append("t.status = %s")
            params.append(status)

        total = self.db.execute(
            f"SELECT COUNT(*) FROM stock_transfers t WHERE {' AND '.join(where)}",
            params,
        ).fetchone()[0]

        rows = self.db.execute(f"""
            SELECT
                t.id,
                'TRF-' || to_char(t.created_at, 'YYYY') || '-' || lpad(t.id::text, 5, '0') AS reference_number,
                t.from_location_id,
                fl.name AS from_location_name,
                t.to_location_id,
                tl.name AS to_location_name,
                t.status,
                t.notes,
                t.created_at,
                t.confirmed_at,
                t.cancelled_at,
                COUNT(ln.id) AS line_count
            FROM stock_transfers t
            JOIN stock_locations fl  ON fl.id = t.from_location_id
            JOIN stock_locations tl  ON tl.id = t.to_location_id
            LEFT JOIN stock_transfer_lines ln ON ln.transfer_id = t.id
            WHERE {' AND '.join(where)}
            GROUP BY t.id, t.from_location_id, fl.name, t.to_location_id, tl.name,
                     t.status, t.notes, t.created_at, t.confirmed_at, t.cancelled_at
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT %s OFFSET %s
        """, params + [limit, offset]).fetchall()

        return {"transfers": [dict(r) for r in rows], "total": total}

    def create_transfer(
        self,
        from_location_id: int,
        to_location_id: int,
        notes: str | None,
        lines: list[dict],
    ) -> dict:
        cur = self.db.execute("""
            INSERT INTO stock_transfers (from_location_id, to_location_id, notes)
            VALUES (%s, %s, %s)
        """, (from_location_id, to_location_id, notes))
        transfer_id = cur.lastrowid

        for line in lines:
            unit_row = self.db.execute(
                "SELECT unit_id FROM products WHERE id = %s", (line["product_id"],)
            ).fetchone()
            unit_id = unit_row["unit_id"] if unit_row else None
            self.db.execute("""
                INSERT INTO stock_transfer_lines (transfer_id, product_id, quantity, unit_id, notes)
                VALUES (%s, %s, %s, %s, %s)
            """, (transfer_id, line["product_id"], line["quantity"], unit_id, line.get("notes")))

        self.db.commit()
        return self.get_transfer(transfer_id)

    def get_transfer(self, transfer_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT
                t.id,
                'TRF-' || to_char(t.created_at, 'YYYY') || '-' || lpad(t.id::text, 5, '0') AS reference_number,
                t.from_location_id,
                fl.name AS from_location_name,
                t.to_location_id,
                tl.name AS to_location_name,
                t.status,
                t.notes,
                t.created_at,
                t.confirmed_at,
                t.cancelled_at,
                COUNT(ln.id) AS line_count
            FROM stock_transfers t
            JOIN stock_locations fl  ON fl.id = t.from_location_id
            JOIN stock_locations tl  ON tl.id = t.to_location_id
            LEFT JOIN stock_transfer_lines ln ON ln.transfer_id = t.id
            WHERE t.id = %s
            GROUP BY t.id, t.from_location_id, fl.name, t.to_location_id, tl.name,
                     t.status, t.notes, t.created_at, t.confirmed_at, t.cancelled_at
        """, (transfer_id,)).fetchone()
        if not row:
            return None

        result = dict(row)

        lines = self.db.execute("""
            SELECT
                ln.id,
                ln.product_id,
                p.name  AS product_name,
                uom.abbreviation AS unit,
                ln.quantity,
                COALESCE(ib.quantity, 0) AS available_qty,
                ln.notes
            FROM stock_transfer_lines ln
            JOIN products p ON p.id = ln.product_id
            LEFT JOIN units_of_measure uom ON uom.id = ln.unit_id
            LEFT JOIN inventory_balances ib
                ON ib.product_id = ln.product_id AND ib.location_id = %s
            WHERE ln.transfer_id = %s
            ORDER BY p.name
        """, (result["from_location_id"], transfer_id)).fetchall()

        result["lines"] = [dict(l) for l in lines]
        return result

    def confirm_transfer(self, transfer_id: int) -> dict | None:
        t = self._get_header(transfer_id)
        if not t or t["status"] != "draft":
            return None

        lines = self.db.execute("""
            SELECT product_id, quantity, unit_id
            FROM stock_transfer_lines
            WHERE transfer_id = %s
        """, (transfer_id,)).fetchall()

        from_loc = t["from_location_id"]
        to_loc   = t["to_location_id"]
        ref_note = f"Transfer {t['reference_number']}"
        postings: list[dict] = []

        for ln in lines:
            product_id = ln["product_id"]
            quantity   = ln["quantity"]
            unit_id    = ln["unit_id"]

            postings.extend([
                {
                    "product_id": product_id,
                    "location_id": from_loc,
                    "movement_type": "transfer_out",
                    "quantity": -quantity,
                    "unit_id": unit_id,
                    "reference_type": "stock_transfer",
                    "reference_id": transfer_id,
                    "notes": ref_note,
                },
                {
                    "product_id": product_id,
                    "location_id": to_loc,
                    "movement_type": "transfer_in",
                    "quantity": quantity,
                    "unit_id": unit_id,
                    "reference_type": "stock_transfer",
                    "reference_id": transfer_id,
                    "notes": ref_note,
                },
            ])

        result = post_movements(self.db, postings, commit=False)
        if not result["success"]:
            return None

        # If the destination has an active count session, keep its lines current
        active_count = self.db.execute("""
            SELECT id FROM stock_count_sessions
            WHERE location_id = %s AND status IN ('draft', 'pending_approval')
            ORDER BY id DESC LIMIT 1
        """, (to_loc,)).fetchone()

        if active_count:
            csid = active_count["id"]
            for ln in lines:
                self.db.execute("""
                    INSERT INTO stock_count_lines (session_id, product_id, system_qty, unit_id)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (session_id, product_id) DO UPDATE
                    SET system_qty = COALESCE(stock_count_lines.system_qty, 0) + EXCLUDED.system_qty
                """, (csid, ln["product_id"], ln["quantity"], ln["unit_id"]))

        self.db.execute("""
            UPDATE stock_transfers
            SET status = 'confirmed', confirmed_at = NOW()
            WHERE id = %s
        """, (transfer_id,))
        self.db.commit()
        return self.get_transfer(transfer_id)

    def cancel_transfer(self, transfer_id: int) -> dict | None:
        t = self._get_header(transfer_id)
        if not t or t["status"] != "draft":
            return None

        self.db.execute("""
            UPDATE stock_transfers
            SET status = 'cancelled', cancelled_at = NOW()
            WHERE id = %s
        """, (transfer_id,))
        self.db.commit()
        return self.get_transfer(transfer_id)

    def _get_header(self, transfer_id: int) -> dict | None:
        row = self.db.execute("""
            SELECT id,
                   'TRF-' || to_char(created_at, 'YYYY') || '-' || lpad(id::text, 5, '0') AS reference_number,
                   from_location_id, to_location_id, status
            FROM stock_transfers
            WHERE id = %s
        """, (transfer_id,)).fetchone()
        return dict(row) if row else None


def get_transfers_repo(db: DBConnection = Depends(get_db)) -> TransfersRepository:
    return TransfersRepository(db)
