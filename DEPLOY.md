# Bound — Deployment

`start.bat` is the local/dev helper and is unchanged. Production uses the
configuration below. No localhost defaults and no CORS wildcard are allowed
in the production path (the backend refuses to boot otherwise).

## Backend

| Variable | Required in production | Example |
|---|---|---|
| `ENV` | yes — set to `production` (also hides `/docs`) | `production` |
| `CORS_ORIGINS` | yes — explicit frontend origin(s), comma-separated, no `*` | `https://bound.example.com` |
| `PORT` | no — platform-provided; falls back to `4000` | `10000` |

```bash
pip install -r backend/requirements.txt
ENV=production CORS_ORIGINS=https://bound.example.com \
  uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-4000} --workers 1
```

Or on a Procfile-based platform (`Procfile` is included): it runs the same
command. Keep exactly one worker — SQLite cannot take concurrent writers.
The SQLite file lives at `backend/bound.db` and is created (with seed data)
on first boot; back it up like any database file.

## Frontend

| Variable | Required in production | Example |
|---|---|---|
| `VITE_API_URL` | yes — baked into the build, must be the public backend URL | `https://bound-api.example.com` |

```bash
npm install
VITE_API_URL=https://bound-api.example.com npm run build
```

Serve the resulting `dist/` directory with any static host. If `VITE_API_URL`
is unset the build falls back to `http://localhost:4000`, which is only
correct for local development (`npm run dev` + `.env`).
