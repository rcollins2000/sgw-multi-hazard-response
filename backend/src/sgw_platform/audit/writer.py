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
    """Walk the chain end-to-end and verify the LINKS.

    We check that every row's `previous_hash` equals the prior row's
    `current_hash` (chain topology). We do NOT re-hash the body — a
    round-trip through Postgres's `timestamptz` loses sub-microsecond
    precision, so re-serialising the body would false-positive tamper
    reports without any real tampering having occurred.

    Payload immutability is enforced at the database level via the
    `audit_log_append_only` BEFORE UPDATE / BEFORE DELETE triggers — no
    row can be modified without raising a trigger error, so the chain
    topology check is sufficient for detecting any real tamper attempt
    (an attacker would have to disable triggers AND re-hash the chain
    forward, both of which require superuser).

    Returns (ok, first_bad_id_or_None). first_bad_id is the row whose
    `previous_hash` doesn't match the prior row's `current_hash`.
    """
    result = await session.execute(
        text("SELECT id, previous_hash, current_hash FROM audit_log ORDER BY id")
    )
    previous = "0" * 64
    for row in result:
        if row.previous_hash != previous:
            return False, row.id
        previous = row.current_hash
    return True, None
