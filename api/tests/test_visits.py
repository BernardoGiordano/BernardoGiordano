"""POST /api/visits, which is the one endpoint a signed-out visitor writes with.

Two things are worth a test and neither can be answered by reading the function:
that a ref nothing on the site is called cannot put a row in the table, and that
the same reader asking twice inside the window is one view. Both run against a
real MySQL, because both are decided by a primary key.
"""

import pytest

from app import db


TEST_SLUG = "pytest-visits-post"


def _views(scope, ref):
    with db.connect() as connection:
        row = db.one(connection, "SELECT views FROM visits WHERE scope = %s AND ref = %s", (scope, ref))
        return int(row["views"]) if row else 0


def _clear():
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM visits WHERE scope = 'post' AND ref = %s", (TEST_SLUG,))
        db.execute(connection, "DELETE FROM posts WHERE slug = %s", (TEST_SLUG,))
        # Every mark this file can have written, so a re-run starts from nothing:
        # the digest is not reversible, and the window it was made in is inside
        # it, so there is no narrower way to name them.
        db.execute(connection, "DELETE FROM visit_marks WHERE created_at > NOW() - INTERVAL 1 DAY")


@pytest.fixture
def post():
    """A published post to count, gone again afterwards."""
    _clear()
    with db.connect() as connection:
        db.execute(
            connection,
            """INSERT INTO posts (slug, title, summary, body, published_on, draft, reading_minutes)
               VALUES (%s, 'Pytest', '', '', CURRENT_DATE, 0, 1)""",
            (TEST_SLUG,),
        )
    yield TEST_SLUG
    _clear()


# A user agent with none of the words that make one a crawler: an empty header is
# itself a robot as far as the endpoint is concerned.
READER = {"user-agent": "Mozilla/5.0 (pytest) Gecko/20100101 Firefox/141.0"}


def test_a_post_nobody_wrote_is_not_countable(client):
    response = client.post("/api/visits", json={"scope": "post", "ref": "no-such-post-here"}, headers=READER)

    assert response.status_code == 404
    assert _views("post", "no-such-post-here") == 0


def test_a_tab_that_is_not_a_tab_is_not_countable(client):
    response = client.post("/api/visits", json={"scope": "tab", "ref": "not-a-tab"}, headers=READER)

    assert response.status_code == 404
    assert _views("tab", "not-a-tab") == 0


def test_the_same_reader_inside_the_window_is_one_view(client, post):
    first = client.post("/api/visits", json={"scope": "post", "ref": post}, headers=READER)
    second = client.post("/api/visits", json={"scope": "post", "ref": post}, headers=READER)

    assert first.status_code == 200
    assert first.json() == {"views": 1}
    # Answered, not refused: there is nothing the visitor could do about it.
    assert second.status_code == 200
    assert second.json() == {"views": 1}
    assert _views("post", post) == 1


def test_a_crawler_is_answered_and_not_counted(client, post):
    response = client.post(
        "/api/visits",
        json={"scope": "post", "ref": post},
        headers={"user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"},
    )

    assert response.status_code == 200
    assert response.json() == {"views": 0}
    assert _views("post", post) == 0


def test_the_count_reaches_the_post_list(client, post):
    client.post("/api/visits", json={"scope": "post", "ref": post}, headers=READER)

    rows = client.get("/api/posts").json()["rows"]
    counted = next(row for row in rows if row["slug"] == post)

    assert counted["views"] == 1
