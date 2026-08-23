"""Fixtures for the API tests.

These run against a real MySQL. The thing most worth testing here is transaction
behaviour — whether a row written on the way to an error survives the error — and
a stubbed connection would answer that by assumption rather than by observation.
Point DB_* at a scratch database if you would rather they did not touch the
development one; either way everything they write is namespaced to TEST_IP and
TEST_USERNAME and removed again.
"""

import ipaddress
import sys
from datetime import timedelta
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))


def _load_env_local():
    """`pytest` on its own, without the `set -a && . ./.env.local` dance from
    DEVELOPING.md. Anything already exported wins, so the dance still works."""
    import os

    env_file = API_ROOT / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_local()

from app import auth, db  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402

# TEST-NET-3 (RFC 5737): reserved for documentation, so it cannot collide with a
# real client's attempts in a shared database.
TEST_IP = "203.0.113.7"
TEST_IP_PACKED = ipaddress.ip_address(TEST_IP).packed
TEST_USERNAME = "pytest-login-throttle"
TEST_PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="session", autouse=True)
def require_database():
    try:
        with db.connect() as connection:
            db.one(connection, "SELECT 1 AS ok")
    except Exception as error:  # pragma: no cover - environment, not behaviour
        pytest.skip(f"no database reachable: {error}")


def _clear():
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM login_attempts WHERE ip = %s", (TEST_IP_PACKED,))
        db.execute(connection, "DELETE FROM users WHERE username = %s", (TEST_USERNAME,))


@pytest.fixture
def account():
    """The account the login tests authenticate against, gone again afterwards.
    Its sessions go with it: sessions.user_id cascades on delete."""
    _clear()
    with db.connect() as connection:
        db.execute(
            connection,
            "INSERT INTO users (username, display_name, password_hash) VALUES (%s, %s, %s)",
            (TEST_USERNAME, "Pytest", auth.hash_password(TEST_PASSWORD)),
        )
    yield {"username": TEST_USERNAME, "password": TEST_PASSWORD}
    _clear()


@pytest.fixture
def client():
    """A client presenting one fixed address, because the limit is per IP. The
    TestClient is not used as a context manager on purpose: entering it would run
    main's lifespan and start the GitHub poller, which these tests have no use
    for."""
    from starlette.testclient import TestClient

    return TestClient(fastapi_app, client=(TEST_IP, 47321))


@pytest.fixture
def attempts():
    """Counts read on a connection of this fixture's own, so it sees only what the
    endpoint under test committed — the whole point of the regression."""

    def count(ok=None):
        sql = "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = %s"
        params = [TEST_IP_PACKED]
        if ok is not None:
            sql += " AND ok = %s"
            params.append(1 if ok else 0)
        with db.connect() as connection:
            return db.one(connection, sql, tuple(params))["n"]

    return count


@pytest.fixture
def attempt_rows():
    def rows():
        with db.connect() as connection:
            return db.rows(
                connection,
                "SELECT id, username, ok, created_at FROM login_attempts WHERE ip = %s ORDER BY id",
                (TEST_IP_PACKED,),
            )

    return rows


@pytest.fixture
def backdate():
    """Age a login_attempts row. created_at defaults to now and the purge is the
    only thing that reads it, so this is the only way to test the purge without
    waiting a week."""

    def move(attempt_id, days):
        with db.connect() as connection:
            db.execute(
                connection,
                "UPDATE login_attempts SET created_at = %s WHERE id = %s",
                (auth._now() - timedelta(days=days), attempt_id),
            )

    return move


@pytest.fixture
def clean_attempts():
    """For tests that write attempts without going through the account fixture."""
    _clear()
    yield
    _clear()
