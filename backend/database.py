from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.engine import Engine
import os
import logging

logger = logging.getLogger("bound.db")

# SQLite file lives next to this module
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "bound.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False is required for SQLite with FastAPI
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# Enable foreign keys and WAL for robustness
@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
    except Exception as e:
        logger.warning(f"Failed to set SQLite pragmas: {e}")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
        # If the endpoint did not commit, we don't auto-commit; just ensure no pending transaction leaks
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            db.close()
        except Exception:
            pass


def init_db():
    # Import models so they are registered on Base.metadata
    import backend.models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # Verify FK enforcement
    try:
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("PRAGMA foreign_keys=ON"))
    except Exception as e:
        logger.warning(f"Failed to verify FK pragma: {e}")


def ensure_schema_upgrades(bind_engine=None):
    """Additive upgrades for databases created before Phase 2.

    - Adds agents.domain / agents.is_task_agent when missing (existing rows
      keep working; new columns default to OTHER / false).
    - Backfills domains for the well-known seed agents ONLY at the moment the
      column is first added (never overwrites user edits on later startups).
      Classification follows seeded mandate semantics, not agent names:
      shopping-agent holds the Grocery mandate -> FOOD, travel-agent holds
      the Airlines mandate -> TRAVEL, everything else stays OTHER.
    - New tables (tasks, approvals) are created by create_all; this only
      handles the ALTER TABLE part that create_all cannot do.
    Idempotent and safe to call on every startup.
    """
    from sqlalchemy import text as _text

    eng = bind_engine or engine
    try:
        with eng.connect() as conn:
            cols = [row[1] for row in conn.execute(_text("PRAGMA table_info(agents)")).fetchall()]
            added_domain = False
            if "domain" not in cols:
                conn.execute(_text("ALTER TABLE agents ADD COLUMN domain VARCHAR DEFAULT 'OTHER'"))
                added_domain = True
            if "is_task_agent" not in cols:
                conn.execute(_text("ALTER TABLE agents ADD COLUMN is_task_agent BOOLEAN DEFAULT 0"))
            conn.commit()
            if added_domain:
                # One-time backfill for pre-existing seed rows only.
                conn.execute(
                    _text("UPDATE agents SET domain='FOOD' WHERE id='shopping-agent' AND (domain IS NULL OR domain='OTHER')")
                )
                conn.execute(
                    _text("UPDATE agents SET domain='TRAVEL' WHERE id='travel-agent' AND (domain IS NULL OR domain='OTHER')")
                )
                conn.commit()
                logger.info("Backfilled agent domains for seed agents (FOOD/TRAVEL).")
    except Exception as e:
        logger.warning(f"Schema upgrade check failed (non-fatal): {e}")
