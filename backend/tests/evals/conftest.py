"""Eval test fixtures — dispose engine per-test."""

from __future__ import annotations

import pytest

from sgw_platform.db import session as session_module


@pytest.fixture(autouse=True)
async def _fresh_engine():
    await session_module.dispose_engine()
    yield
    await session_module.dispose_engine()
