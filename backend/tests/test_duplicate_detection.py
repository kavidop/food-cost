"""Tests for duplicate invoice detection endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db


def make_client(db_conn):
    """Override the DB dependency with our in-memory fixture."""
    def override():
        yield db_conn

    app.dependency_overrides[get_db] = override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client(seeded_db):
    yield from make_client(seeded_db)


def test_no_duplicate_for_new_invoice(client):
    resp = client.get("/api/invoices/check-duplicate", params={
        "vat": "VAT001", "invoice_number": "INV-999"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["duplicate"] is False
    assert data["existing"] is None


def test_detects_duplicate(client):
    resp = client.get("/api/invoices/check-duplicate", params={
        "vat": "VAT001", "invoice_number": "INV-001"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["duplicate"] is True
    assert data["existing"]["id"] == 1
    assert data["existing"]["supplier_name"] == "Test Supplier"


def test_empty_params_returns_no_duplicate(client):
    resp = client.get("/api/invoices/check-duplicate", params={"vat": "", "invoice_number": ""})
    assert resp.status_code == 200
    assert resp.json()["duplicate"] is False


def test_unknown_vat_returns_no_duplicate(client):
    resp = client.get("/api/invoices/check-duplicate", params={
        "vat": "UNKNOWN", "invoice_number": "INV-001"
    })
    assert resp.status_code == 200
    assert resp.json()["duplicate"] is False
