# Zubro Food Cost — Architecture

## Active stack

| Directory  | Role                                     | Run with                          |
|------------|------------------------------------------|-----------------------------------|
| `backend/` | FastAPI REST API, SQLite, Pydantic       | `cd backend && uvicorn app.main:app --reload` |
| `frontend/`| React 18 + Vite + TypeScript SPA         | `cd frontend && npm run dev`       |

The Vite dev server proxies `/api/*` → `http://localhost:8000`, so both can run independently.

## Legacy (do not use)

| Directory  | Status                                   |
|------------|------------------------------------------|
| `webapp/`  | **Deprecated** — original Flask monolith. Kept for reference. See `webapp/DEPRECATED.md`. |

## Database

`zubro_food_cost.db` at the repo root is shared by both stacks during the transition period.
Once the legacy app is removed, the DB path will be locked to `backend/`.
