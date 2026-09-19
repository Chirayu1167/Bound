"""
Provenance hash-linked chain — Phase 5.

Append-only, tamper-evident.

event_hash = SHA256(
  sequence_number|event_type|timestamp|actor|parent|mandate|delegation|transaction|decision|reason|event_data|previous_hash
)

event_data is canonical JSON (sorted keys).
"""

import hashlib
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend import models


def _canonical_json(data) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        # Assume already JSON string; try to parse and re-canonicalize
        try:
            parsed = json.loads(data)
            return json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        except:
            return data
    # dict or other
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _compute_hash(
    sequence_number: int,
    event_type: str,
    timestamp_iso: str,
    actor_agent_id: str | None,
    parent_agent_id: str | None,
    mandate_id: str | None,
    delegation_id: str | None,
    transaction_id: str | None,
    decision: str | None,
    reason: str | None,
    event_data: str | None,
    previous_hash: str | None,
) -> str:
    # Canonical serialization — same order every time
    payload = "|".join(
        [
            str(sequence_number),
            event_type or "",
            timestamp_iso or "",
            actor_agent_id or "",
            parent_agent_id or "",
            mandate_id or "",
            delegation_id or "",
            transaction_id or "",
            decision or "",
            reason or "",
            event_data or "",
            previous_hash or "",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def append_event(
    db: Session,
    event_type: str,
    actor_agent_id: str | None = None,
    parent_agent_id: str | None = None,
    mandate_id: str | None = None,
    delegation_id: str | None = None,
    transaction_id: str | None = None,
    decision: str | None = None,
    reason: str | None = None,
    event_data: dict | str | None = None,
    timestamp: datetime | None = None,
) -> models.ProvenanceEvent:
    """
    Append a new provenance event with correct sequence and hash linking.
    Uses DB max sequence to ensure ordering. Commits immediately.
    Handles concurrent writes via retry on IntegrityError (duplicate sequence).
    """
    # Normalize timestamp
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp_iso = timestamp.isoformat()

    # Canonical event_data
    event_data_str = _canonical_json(event_data) if event_data is not None else None
    if event_data_str == "":
        event_data_str = None

    # Retry loop for concurrent sequence collisions
    for attempt in range(5):
        # Determine previous hash and next sequence
        last = db.query(models.ProvenanceEvent).order_by(models.ProvenanceEvent.sequence_number.desc()).first()
        if last:
            previous_hash = last.event_hash
            next_seq = last.sequence_number + 1
        else:
            previous_hash = None
            next_seq = 1

        event_hash = _compute_hash(
            sequence_number=next_seq,
            event_type=event_type,
            timestamp_iso=timestamp_iso,
            actor_agent_id=actor_agent_id,
            parent_agent_id=parent_agent_id,
            mandate_id=mandate_id,
            delegation_id=delegation_id,
            transaction_id=transaction_id,
            decision=decision,
            reason=reason,
            event_data=event_data_str,
            previous_hash=previous_hash,
        )

        evt = models.ProvenanceEvent(
            id=f"evt-{uuid.uuid4().hex[:8]}",
            sequence_number=next_seq,
            event_type=event_type,
            timestamp=timestamp,
            actor_agent_id=actor_agent_id,
            parent_agent_id=parent_agent_id,
            mandate_id=mandate_id,
            delegation_id=delegation_id,
            transaction_id=transaction_id,
            decision=decision,
            reason=reason,
            event_data=event_data_str,
            previous_hash=previous_hash,
            event_hash=event_hash,
        )
        try:
            db.add(evt)
            db.commit()
            db.refresh(evt)
            return evt
        except Exception as e:
            db.rollback()
            # Check if it's a duplicate sequence/hash error and retry
            err_str = str(e).lower()
            if "unique" in err_str or "integrity" in err_str or "duplicate" in err_str:
                if attempt < 4:
                    # Brief backoff
                    import time as _time

                    _time.sleep(0.02 * (attempt + 1))
                    continue
            raise
    # If we exhausted retries, raise last error
    raise RuntimeError("Failed to append provenance event after retries due to concurrent sequence collision")


def verify_chain(db: Session) -> dict:
    """
    Walk stored chain and verify:
    - sequence ordering (1..n no gaps)
    - previous_hash linkage
    - event_hash correctness
    Returns dict with valid, events_checked, first/last, broken info.
    """
    events = db.query(models.ProvenanceEvent).order_by(models.ProvenanceEvent.sequence_number.asc()).all()
    if not events:
        return {
            "valid": True,
            "events_checked": 0,
            "first_event": None,
            "last_event": None,
            "message": "No provenance events — chain empty but consistent.",
        }

    # Check sequence starts at 1 and increments by 1
    for idx, evt in enumerate(events, start=1):
        if evt.sequence_number != idx:
            return {
                "valid": False,
                "events_checked": idx,
                "broken_event_id": evt.id,
                "reason": f"Sequence gap: expected {idx}, got {evt.sequence_number}",
                "expected_sequence": idx,
                "actual_sequence": evt.sequence_number,
            }

    # Verify hash linkage and correctness
    previous_hash = None
    for evt in events:
        # Check previous_hash linkage
        if evt.previous_hash != previous_hash:
            return {
                "valid": False,
                "events_checked": evt.sequence_number,
                "broken_event_id": evt.id,
                "reason": f"Previous hash mismatch at sequence {evt.sequence_number}: expected {previous_hash}, got {evt.previous_hash}",
                "expected_previous": previous_hash,
                "actual_previous": evt.previous_hash,
            }

        # Recompute hash
        timestamp_iso = evt.timestamp.isoformat() if evt.timestamp.tzinfo else evt.timestamp.replace(tzinfo=timezone.utc).isoformat()
        recomputed = _compute_hash(
            sequence_number=evt.sequence_number,
            event_type=evt.event_type,
            timestamp_iso=timestamp_iso,
            actor_agent_id=evt.actor_agent_id,
            parent_agent_id=evt.parent_agent_id,
            mandate_id=evt.mandate_id,
            delegation_id=evt.delegation_id,
            transaction_id=evt.transaction_id,
            decision=evt.decision,
            reason=evt.reason,
            event_data=evt.event_data,
            previous_hash=previous_hash,
        )
        if recomputed != evt.event_hash:
            return {
                "valid": False,
                "events_checked": evt.sequence_number,
                "broken_event_id": evt.id,
                "reason": f"Event hash mismatch at sequence {evt.sequence_number}: recomputed {recomputed}, stored {evt.event_hash}",
                "expected_hash": recomputed,
                "actual_hash": evt.event_hash,
            }

        previous_hash = evt.event_hash

    return {
        "valid": True,
        "events_checked": len(events),
        "first_event": events[0].id,
        "last_event": events[-1].id,
        "first_hash": events[0].event_hash,
        "last_hash": events[-1].event_hash,
        "message": "Provenance chain is valid.",
    }
