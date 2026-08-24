import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import auth, config, db
from ..auth import require_writer
from ..models import VisitBody, visit_json

router = APIRouter(prefix="/api/visits", tags=["visits"])

# The four sections of the site, and the only refs `tab` accepts. Written here
# rather than read from a table because the tab bar is four entries in
# web/src/pages/shell-layout.js and not content: a fifth tab is a code change on
# both sides, and until it is one this list is what keeps the table from
# collecting rows for names nothing on the site is called.
TABS = ("projects", "art", "cv", "blog")

# Substrings that make a user agent something other than a reader. Crude on
# purpose: this is a view counter on a personal site, and the alternative — a
# list of every crawler there is, kept current — is a second job. A crawler that
# lies about its agent is counted, and that is the accepted error.
ROBOTS = ("bot", "crawl", "spider", "slurp", "headless", "preview", "monitor", "curl", "wget")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _looks_like_a_robot(request: Request) -> bool:
    agent = request.headers.get("user-agent", "").lower()
    return agent == "" or any(name in agent for name in ROBOTS)


def _mark(request: Request, scope: str, ref: str) -> str:
    """The stand-in for a visitor: address, agent and the window they arrived in,
    salted and hashed. Only the digest is stored, and the window is inside it
    rather than compared against `created_at` — a new window is a different mark,
    so the same reader counts again tomorrow without anything having to expire
    first for them to."""
    host = request.client.host if request.client else ""
    agent = request.headers.get("user-agent", "")
    window = int(_now().timestamp()) // (config.VISIT_WINDOW_HOURS * 3600)
    raw = "\x1f".join([config.VISIT_SALT, scope, ref, host, agent, str(window)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _views(connection, scope: str, ref: str) -> int:
    row = db.one(connection, "SELECT views FROM visits WHERE scope = %s AND ref = %s", (scope, ref))
    return int(row["views"]) if row else 0


def _exists(connection, scope: str, ref: str) -> bool:
    if scope == "tab":
        return ref in TABS
    row = db.one(connection, "SELECT id FROM posts WHERE slug = %s AND draft = 0", (ref,))
    return row is not None


@router.post("")
def record(body: VisitBody, request: Request):
    """Count one view, and answer with the total either way.

    Three things are not counted and all three answer 200 with the count as it
    stands, because a visitor has nothing to do about any of them: a crawler, the
    one person who can sign in — whose own reading would otherwise be most of the
    numbers on a site this size — and a reader already counted for this thing
    inside the window."""
    scope, ref = body.scope, body.ref

    with db.connect() as connection:
        if not _exists(connection, scope, ref):
            raise HTTPException(status_code=404, detail="no_such_target")

        if _looks_like_a_robot(request) or auth.current(connection, request) is not None:
            return {"views": _views(connection, scope, ref)}

        # INSERT IGNORE rather than a SELECT first: the primary key is the
        # decision, so two requests racing for the same mark cannot both win it.
        # The row count is the answer to who did, which is why this is a cursor
        # rather than db.execute — that one returns the insert id.
        with connection.cursor() as cursor:
            cursor.execute("INSERT IGNORE INTO visit_marks (mark) VALUES (%s)", (_mark(request, scope, ref),))
            counted = cursor.rowcount == 1

        if counted:
            db.execute(
                connection,
                """INSERT INTO visits (scope, ref, views) VALUES (%s, %s, 1)
                   ON DUPLICATE KEY UPDATE views = views + 1""",
                (scope, ref),
            )

        return {"views": _views(connection, scope, ref)}


@router.get("")
def list_visits(_=Depends(require_writer)):
    """Every counter, for the one account that can read them. Public pages print
    a post's own number and nothing else: what the tabs add up to is the site
    owner's business and not the visitor's."""
    with db.connect() as connection:
        rows = db.rows(connection, "SELECT * FROM visits ORDER BY scope, views DESC, ref")
        return [visit_json(row) for row in rows]


def purge(connection) -> int:
    """Marks older than two windows. One window would be enough — a mark from the
    window before this one can no longer be matched — and two is the margin for a
    clock that moved."""
    cutoff = _now() - timedelta(hours=config.VISIT_WINDOW_HOURS * 2)
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM visit_marks WHERE created_at < %s", (cutoff,))
        return cursor.rowcount
