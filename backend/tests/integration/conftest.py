"""Integration test fixtures — dispose engine per-test to avoid event-loop-closed errors.

pytest-asyncio creates a fresh event loop per test by default; the cached engine's
connection pool holds references to the previous loop, so we tear down + recreate.
"""

from __future__ import annotations

import pytest

from sgw_platform.db import session as session_module


@pytest.fixture(autouse=True)
async def _fresh_engine():
    """Reset the cached engine before and after each test."""
    await session_module.dispose_engine()
    yield
    await session_module.dispose_engine()
