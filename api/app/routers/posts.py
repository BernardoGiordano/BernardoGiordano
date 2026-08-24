import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import auth, db
from ..auth import require_writer
from ..models import PostBody, PostPatch, post_json

router = APIRouter(prefix="/api/posts", tags=["posts"])

COLUMNS = {
    "slug": "slug",
    "title": "title",
    "summary": "summary",
    "body": "body",
    "coverUrl": "cover_url",
    "language": "language",
    "publishedOn": "published_on",
    "draft": "draft",
    # Derived, not accepted: PostPatch has no such field, so it can only be set
    # by the recount below.
    "readingMinutes": "reading_minutes",
}

WORDS_PER_MINUTE = 220


def reading_minutes(body: str) -> int:
    return max(1, round(len(re.findall(r"\w+", body, flags=re.UNICODE)) / WORDS_PER_MINUTE))


def _tags_for(connection, post_ids):
    if not post_ids:
        return {}
    marks = ", ".join(["%s"] * len(post_ids))
    grouped = {}
    for row in db.rows(connection, f"SELECT post_id, tag FROM post_tags WHERE post_id IN ({marks}) ORDER BY tag", tuple(post_ids)):
        grouped.setdefault(row["post_id"], []).append(row["tag"])
    return grouped


def _signed_in(connection, request: Request) -> bool:
    """Drafts are visible only to the owner. Checked without a dependency because
    the list endpoint is public and a dependency raising 401 would close it."""
    return auth.current(connection, request) is not None


@router.get("")
def list_posts(
    request: Request,
    tag: str | None = None,
    limit: int = Query(default=12, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
):
    with db.connect() as connection:
        include_drafts = _signed_in(connection, request)
        where = ["1 = 1"] if include_drafts else ["p.draft = 0"]
        params = []

        if tag:
            where.append("EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.tag = %s)")
            params.append(tag)

        clause = " AND ".join(where)
        total = db.one(connection, f"SELECT COUNT(*) AS n FROM posts p WHERE {clause}", tuple(params))
        # The view counter is a table of its own, keyed by slug rather than by
        # id: it is written by an endpoint that is given a URL and never an
        # internal number, and a post that is deleted and rewritten under the
        # same address keeps the count that address earned.
        rows = db.rows(
            connection,
            f"""SELECT p.*, COALESCE(v.views, 0) AS views FROM posts p
                LEFT JOIN visits v ON v.scope = 'post' AND v.ref = p.slug
                WHERE {clause}
                ORDER BY p.published_on DESC, p.id DESC LIMIT %s OFFSET %s""",
            (*params, limit, offset),
        )
        grouped = _tags_for(connection, [row["id"] for row in rows])

        visible = "" if include_drafts else "WHERE p.draft = 0"
        tags = db.rows(
            connection,
            f"""SELECT t.tag, COUNT(*) AS n FROM post_tags t JOIN posts p ON p.id = t.post_id
                {visible} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 40""",
        )

        return {
            "rows": [post_json(row, grouped.get(row["id"], []), include_body=False) for row in rows],
            "total": total["n"],
            "tags": [row["tag"] for row in tags],
        }


@router.get("/{slug}")
def read_post(slug: str, request: Request):
    with db.connect() as connection:
        row = db.one(
            connection,
            """SELECT p.*, COALESCE(v.views, 0) AS views FROM posts p
               LEFT JOIN visits v ON v.scope = 'post' AND v.ref = p.slug
               WHERE p.slug = %s""",
            (slug,),
        )
        if row is None or (row["draft"] and not _signed_in(connection, request)):
            raise HTTPException(status_code=404, detail="no_such_post")
        tags = _tags_for(connection, [row["id"]]).get(row["id"], [])
        return post_json(row, tags, include_body=True)


def _write_tags(connection, post_id: int, tags):
    db.execute(connection, "DELETE FROM post_tags WHERE post_id = %s", (post_id,))
    cleaned = sorted({tag.strip().lower()[:64] for tag in tags if tag.strip()})
    if cleaned:
        db.many(connection, "INSERT INTO post_tags (post_id, tag) VALUES (%s, %s)", [(post_id, tag) for tag in cleaned])


@router.post("", status_code=201)
def create_post(body: PostBody, request: Request, _=Depends(require_writer)):
    with db.connect() as connection:
        if db.one(connection, "SELECT id FROM posts WHERE slug = %s", (body.slug,)) is not None:
            raise HTTPException(status_code=409, detail="slug_taken")
        post_id = db.execute(
            connection,
            """INSERT INTO posts (slug, title, summary, body, cover_url, language, published_on, draft, reading_minutes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                body.slug, body.title, body.summary, body.body, body.coverUrl, body.language,
                body.publishedOn, body.draft, reading_minutes(body.body),
            ),
        )
        _write_tags(connection, post_id, body.tags)
        row = db.one(connection, "SELECT * FROM posts WHERE id = %s", (post_id,))
        return post_json(row, sorted({t.strip().lower() for t in body.tags if t.strip()}), include_body=True)


@router.put("/{post_id}")
def update_post(post_id: int, patch: PostPatch, _=Depends(require_writer)):
    fields = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if k in COLUMNS}
    with db.connect() as connection:
        if db.one(connection, "SELECT id FROM posts WHERE id = %s", (post_id,)) is None:
            raise HTTPException(status_code=404, detail="no_such_post")

        if "slug" in fields:
            clash = db.one(connection, "SELECT id FROM posts WHERE slug = %s AND id <> %s", (fields["slug"], post_id))
            if clash is not None:
                raise HTTPException(status_code=409, detail="slug_taken")

        if "body" in fields:
            fields["readingMinutes"] = reading_minutes(fields["body"])

        if fields:
            assignments = ", ".join(f"{COLUMNS[key]} = %s" for key in fields)
            db.execute(connection, f"UPDATE posts SET {assignments} WHERE id = %s", [*fields.values(), post_id])

        if patch.tags is not None:
            _write_tags(connection, post_id, patch.tags)

        row = db.one(connection, "SELECT * FROM posts WHERE id = %s", (post_id,))
        tags = _tags_for(connection, [post_id]).get(post_id, [])
        return post_json(row, tags, include_body=True)


@router.delete("/{post_id}", status_code=204)
def delete_post(post_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM posts WHERE id = %s", (post_id,))
