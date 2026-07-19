"""Append-only audit writer with SHA-256 hash chain.

The `audit_log` table has UPDATE/DELETE blocked by triggers (see migration 002).
This writer computes the hash chain so each row references the previous hash —
any tamper breaks the chain, which the verifier walks end-to-end.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.observability.metrics import audit_writes_total


def _canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, default=str)


def _hash(previous: str, row_json: str) -> str:
    return hashlib.sha256((previous + row_json).encode("utf-8")).hexdigest()


async def _get_previous_hash(session: AsyncSession) -> str:
    result = await session.execute(
        text("SELECT current_hash FROM audit_log ORDER BY id DESC LIMIT 1")
    )
    row = result.first()
    return row[0] if row else "0" * 64


async def append(
    session: AsyncSession,
    user: str,
    action_type: str,
    subject_id: str,
    payload: dict[str, Any],
    model_version: str | None = None,
    prompt_version: str | None = None,
    features_hash: str | None = None,
) -> str:
    """Append one row; returns the new current_hash."""
    previous = await _get_previous_hash(session)
    now = datetime.now(UTC)
    row_body = {
        "timestamp": now.isoformat(),
        "user": user,
        "action_type": action_type,
        "subject_id": subject_id,
        "model_version": model_version,
        "prompt_version": prompt_version,
        "features_hash": features_hash,
        "payload": payload,
    }
    current = _hash(previous, _canonical_json(row_body))

    stmt = text(
        "INSERT INTO audit_log "
        "(timestamp, \"user\", action_type, subject_id, model_version, "
        " prompt_version, features_hash, previous_hash, current_hash, payload) "
        "VALUES (:ts, :u, :a, :s, :mv, :pv, :fh, :ph, :ch, :pl)"
    ).bindparams(bindparam("pl", type_=JSONB))
    await session.execute(
        stmt,
        {
            "ts": now,  # asyncpg wants a datetime instance, not an ISO string
            "u": user,
            "a": action_type,
            "s": subject_id,
            "mv": model_version,
            "pv": prompt_version,
            "fh": features_hash,
            "ph": previous,
            "ch": current,
            "pl": payload,
        },
    )
    audit_writes_total.labels(action_type=action_type).inc()
    return current


async def verify_chain(session: AsyncSession) -> tuple[bool, int | None]:
    """Walk the chain end-to-end. Returns (ok, first_bad_id_or_None)."""
    result = await session.execute(
        text(
            "SELECT id, timestamp, \"user\", action_type, subject_id, "
            " model_version, prompt_version, features_hash, previous_hash, current_hash, payload "
            "FROM audit_log ORDER BY id"
        )
    )
    previous = "0" * 64
    for row in result:
        body = {
            "timestamp": row.timestamp.isoformat() if hasattr(row.timestamp, "isoformat") else str(row.timestamp),
            "user": row.user,
            "action_type": row.action_type,
            "subject_id": row.subject_id,
            "model_version": row.model_version,
            "prompt_version": row.prompt_version,
            "features_hash": row.features_hash,
            "payload": row.payload,
        }
        expected = _hash(previous, _canonical_json(body))
        if row.previous_hash != previous or row.current_hash != expected:
            return False, row.id
        previous = row.current_hash
    return True, None
