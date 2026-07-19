"""Phase 0 smoke tests — imports resolve, app builds, settings load."""

from __future__ import annotations


def test_package_imports() -> None:
    import sgw_platform

    assert sgw_platform.__version__ == "0.1.0"


def test_settings_load() -> None:
    from sgw_platform.settings import get_settings

    settings = get_settings()
    assert settings.openai_model == "gpt-5.6"


def test_app_builds() -> None:
    from sgw_platform.api.main import create_app

    app = create_app()
    assert app.title == "SGW Platform"

    # OpenAPI walks the included routers, so it's the authoritative path list.
    paths = set(app.openapi()["paths"].keys())
    assert "/health" in paths
    assert "/ready" in paths
    assert "/metrics" in paths
    assert "/api/status" in paths
    assert "/api/assets" in paths
    assert "/api/decisions" in paths
