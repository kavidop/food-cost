# DEPRECATED — Legacy Application

This directory contains the original monolithic Flask application.
It has been **superseded** and is kept for reference only.

## Replacement

| Layer    | Location     | Technology                        |
|----------|--------------|-----------------------------------|
| Backend  | `../backend` | FastAPI · Pydantic · SQLite (raw) |
| Frontend | `../frontend`| React 18 · Vite · TypeScript      |

## What changed

- `app.py` (single ~2 000-line file) → split into `routes/`, `services/`, `schemas/`
- Jinja2 `index.html` with inline JS → React components with typed API client
- Ad-hoc migration by hand → versioned SQL migrations in `backend/migrations/`
- No tests → pytest suite in `backend/tests/`

## Do not use

- No new features should be added here.
- No bugs should be fixed here.
- The `.env` in this directory is superseded by `../backend/.env`.

This directory will be removed once the new stack is confirmed stable in production.
