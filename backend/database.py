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
