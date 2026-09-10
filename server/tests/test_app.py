"""Integration tests for the FastAPI application shell."""

import pytest
from fastapi.testclient import TestClient
from PIL.Image import Image as PILImage

from untitled_jam.main import create_app


class PassthroughRemover:
    def remove_background(self, image: PILImage) -> PILImage:
        return image.convert("RGBA")


@pytest.fixture
def client():
    with TestClient(create_app(lambda: PassthroughRemover())) as test_client:
        yield test_client


def test_health_response_is_pydantic_validated(client: TestClient) -> None:
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


def test_frontend_is_served_by_fastapi(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "Untitled Jam" in response.text
    assert 'id="root"' in response.text


def test_spa_routes_fall_back_to_the_frontend(client: TestClient) -> None:
    response = client.get("/board/example")

    assert response.status_code == 200
    assert 'id="root"' in response.text


def test_missing_static_assets_return_not_found(client: TestClient) -> None:
    response = client.get("/assets/missing.js")

    assert response.status_code == 404


def test_unknown_api_routes_do_not_return_the_spa(client: TestClient) -> None:
    response = client.get("/api/missing")

    assert response.status_code == 404
    assert response.json() == {"detail": "API endpoint not found"}
