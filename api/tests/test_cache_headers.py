"""What every response says about caching.

Before this, /api, /auth and the three SEO files declared nothing at all and every
one of them was left to a browser heuristic. The rules live in one function, so
most of this is table-driven against that function; the two that go through the
client are the ones the middleware has to get right on a real response — that a
read varies by cookie, and that a header a handler set itself is not overwritten.
"""

import pytest

from app.main import API_READ, DOCUMENT, FEED, NO_STORE, ROBOTS, cache_control


@pytest.mark.parametrize(
    ("path", "method", "expected"),
    [
        ("/api/site", "GET", API_READ),
        ("/api/posts", "HEAD", API_READ),
        ("/api/posts", "POST", NO_STORE),
        ("/api/projects/3", "DELETE", NO_STORE),
        ("/auth/session", "GET", NO_STORE),
        ("/auth/login", "POST", NO_STORE),
        ("/feed.xml", "GET", FEED),
        ("/sitemap.xml", "GET", FEED),
        ("/robots.txt", "GET", ROBOTS),
        ("/projects", "GET", DOCUMENT),
        ("/", "GET", DOCUMENT),
    ],
)
def test_policy(path, method, expected):
    assert cache_control(path, method)[0] == expected


def test_only_reads_vary_by_cookie():
    """GET /api/posts includes drafts for the owner and GET /api/visits is
    owner-only, so a private cache must not answer a signed-in reader with the
    signed-out copy. A write is `no-store` and has nothing to vary."""
    assert cache_control("/api/posts", "GET")[1] is True
    assert cache_control("/api/posts", "POST")[1] is False


def test_read_is_cacheable_and_varies(client):
    response = client.get("/api/site")
    assert response.status_code == 200
    assert response.headers["cache-control"] == API_READ
    assert response.headers["vary"] == "Cookie"


def test_session_is_never_stored(client):
    response = client.get("/auth/session")
    assert response.headers["cache-control"] == NO_STORE
