# Bound backend — production startup (PaaS: Render / Heroku / Dokku / Fly).
# Single worker: SQLite cannot take concurrent writers. No --reload here.
web: uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-4000} --workers 1
