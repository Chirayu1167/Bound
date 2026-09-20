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
| `GROQ_API_KEY` | no — optional AI request assist; without it `/ai/interpret` returns 501 and the app uses its built-in parser | — |
| `GROQ_MODEL` | no — Groq model id (default `llama-3.3-70b-versatile`) | `llama-3.3-70b-versatile` |

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
is unset the app uses `http://localhost:4000` only when the page itself is
served from localhost; on any other host it fails loudly (and logs an error)
instead of silently hitting localhost — so production must always bake in
`VITE_API_URL`.

## Keeping the Render free-tier backend warm

Render free web services sleep after ~15 minutes without inbound traffic.
The first request after sleep takes ~25–30s (we measured ~26s on
`/health`), which is what used to latch the frontend's "Backend offline"
banner. Notes from comparing with the PrepHire-AI setup:

- PrepHire's `render.yaml` sets `healthCheckPath: /api/health`, but that
  only gates deploy health — it does **not** keep a free service awake.
- PrepHire's `node-cron` midnight cleanup is an in-process timer, which also
  does **not** count as inbound traffic, so it does not prevent sleep.
- A backend "runs forever" on Render free only via inbound traffic every
  <15 min (external pinger) or a paid (Starter+) plan that doesn't sleep.

Bound now covers both sides:

1. **Idle (no users):** `.github/workflows/keep-warm.yml` pings
   `GET /health` every 10 minutes (plus manual "Run workflow"). No secret
   needed — it defaults to `https://bound-api-xhbd.onrender.com`; override
   via an Actions repository Variable `BOUND_API_URL`. Alternatives are
   UptimeRobot / cron-job.org on the same endpoint, or upgrading Render to
   Starter.
2. **In session (user has the tab open):** the frontend runs health + data
   fetches in parallel on load and retries `/health` every 10s (up to 10×)
   when offline, so a cold-starting backend self-heals to Online without a
   reload. See `src/App.tsx` / `src/services/api.ts`.
