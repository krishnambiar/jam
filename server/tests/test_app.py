"""Integration tests for the FastAPI application shell."""

from fastapi.testclient import TestClient

from untitled_jam.main import app

client = TestClient(app)


def test_health_response_is_pydantic_validated() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": {
            "name": "Untitled Jam",
            "version": "0.1.0",
            "framework": "FastAPI",
        },
    }


def test_frontend_is_served_by_fastapi() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "Untitled Jam" in response.text
    assert 'id="root"' in response.text


def test_spa_routes_fall_back_to_the_frontend() -> None:
    response = client.get("/board/example")

    assert response.status_code == 200
    assert 'id="root"' in response.text


def test_missing_static_assets_return_not_found() -> None:
    response = client.get("/assets/missing.js")

    assert response.status_code == 404


def test_unknown_api_routes_do_not_return_the_spa() -> None:
    response = client.get("/api/missing")

    assert response.status_code == 404
    assert response.json() == {"detail": "API endpoint not found"}
