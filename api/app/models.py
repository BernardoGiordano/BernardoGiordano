from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from .db import as_list

# ── serialisers: DB row (snake_case) -> JSON (camelCase) ─────────────────────
#
# Written out rather than generated from a naming rule: the wire shape is what
# web/src/services/types.d.ts declares, and a rule that renamed a column would
# silently rename a field the frontend reads.


def _iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(microsecond=0).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def profile_json(row) -> dict:
    return {
        "name": row["name"],
        "headline": row["headline"],
        "bio": row["bio"],
        "location": row["location"],
        "current": row["current"],
        "now": row["now_text"],
        "available": row["available"],
        "email": row["email"],
        "avatarUrl": row["avatar_url"],
    }


def link_json(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "label": row["label"],
        "url": row["url"],
        "position": row["position"],
    }


def stats_json(row) -> dict | None:
    if row is None or row.get("repo") is None:
        return None
    return {
        "stars": row["stars"],
        "forks": row["forks"],
        "downloads": row["downloads"],
        "lastReleaseAt": _iso(row["last_release_at"]),
        "lastReleaseTag": row["last_release_tag"],
        "firstCommitAt": _iso(row["first_commit_at"]),
        "language": row["language"],
        "license": row["license"],
        "refreshedAt": _iso(row["refreshed_at"]),
    }


def totals_json(row) -> dict:
    """The tab bar's two numbers. Not derived from the project list: `owned_repos`
    is every repository the accounts in GITHUB_OWNERS own, and the curated list is
    a handful of them."""
    return {
        "stars": row["stars"],
        "downloads": row["downloads"],
        "repos": row["repos"],
        "refreshedAt": _iso(row["refreshed_at"]),
    }


def project_json(row, stats=None) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "url": row["url"],
        "repo": row["repo"],
        "kind": row["kind"],
        "role": row["role"],
        "status": row["status"],
        "openSource": bool(row["open_source"]),
        "featured": bool(row["featured"]),
        "platforms": as_list(row["platforms"]),
        "tech": as_list(row["tech"]),
        "downloadsOverride": row["downloads_override"],
        "position": row["position"],
        "stats": stats_json(stats),
    }


def art_json(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "subtitle": row["subtitle"],
        "description": row["description"],
        "kind": row["kind"],
        "label": row["label"],
        "releasedOn": _iso(row["released_on"]),
        "formats": as_list(row["formats"]),
        "coverUrl": row["cover_url"],
        "bandcampAlbumId": row["bandcamp_album_id"],
        "catalogNumber": row["catalog_number"],
        "links": as_list(row["links"]),
        "tracks": as_list(row["tracks"]),
        "position": row["position"],
    }


def cv_item_json(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "subtitle": row["subtitle"],
        "detail": row["detail"],
        "period": row["period"],
        "position": row["position"],
    }


def cv_section_json(row, items) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "kind": row["kind"],
        "position": row["position"],
        "items": [cv_item_json(item) for item in items],
    }


def post_json(row, tags, include_body: bool) -> dict:
    body = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "summary": row["summary"],
        "publishedOn": _iso(row["published_on"]),
        "tags": tags,
        "coverUrl": row["cover_url"],
        "readingMinutes": row["reading_minutes"],
        "language": row["language"],
        "draft": bool(row["draft"]),
        # Joined from visits, and 0 for a post nobody has opened yet: the column
        # is absent only when a caller selected the post table on its own, which
        # a reader of this shape should still be able to print.
        "views": int(row.get("views") or 0),
    }
    if include_body:
        body["body"] = row["body"]
    return body


def visit_json(row) -> dict:
    return {
        "scope": row["scope"],
        "ref": row["ref"],
        "views": int(row["views"]),
        "firstAt": _iso(row["first_at"]),
        "lastAt": _iso(row["last_at"]),
    }


# ── request bodies ──────────────────────────────────────────────────────────
#
# Every field is optional and every write is a patch: the frontend edits one card
# at a time and sending the whole record back would let a stale form overwrite a
# field the user never opened.


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    headline: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    location: str | None = Field(default=None, max_length=128)
    current: str | None = Field(default=None, max_length=255)
    now: str | None = Field(default=None, max_length=255)
    available: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, max_length=255)
    avatarUrl: str | None = Field(default=None, max_length=512)


class LinkBody(BaseModel):
    kind: str = Field(max_length=32)
    label: str = Field(max_length=64)
    url: str = Field(max_length=512)


class LinkPatch(BaseModel):
    kind: str | None = Field(default=None, max_length=32)
    label: str | None = Field(default=None, max_length=64)
    url: str | None = Field(default=None, max_length=512)


class ProjectBody(BaseModel):
    name: str = Field(max_length=128)
    description: str = ""
    url: str = Field(default="", max_length=512)
    repo: str = Field(default="", max_length=160)
    kind: str = Field(default="", max_length=32)
    role: str = Field(default="author", max_length=32)
    status: str = Field(default="active", max_length=32)
    openSource: bool = True
    featured: bool = False
    platforms: list[str] = []
    tech: list[str] = []
    downloadsOverride: int | None = None

    @field_validator("repo")
    @classmethod
    def owner_and_name(cls, value: str) -> str:
        """`owner/name` or nothing. The poller interpolates this into a GitHub URL,
        so anything else is refused here rather than producing a request to a path
        somebody chose."""
        if value == "":
            return value
        parts = value.split("/")
        if len(parts) != 2 or not all(p and all(c.isalnum() or c in "._-" for c in p) for p in parts):
            raise ValueError("repo must be owner/name")
        return value


class ProjectPatch(ProjectBody):
    name: str | None = Field(default=None, max_length=128)
    description: str | None = None
    openSource: bool | None = None
    featured: bool | None = None
    platforms: list[str] | None = None
    tech: list[str] | None = None
    url: str | None = Field(default=None, max_length=512)
    repo: str | None = Field(default=None, max_length=160)
    kind: str | None = Field(default=None, max_length=32)
    role: str | None = Field(default=None, max_length=32)
    status: str | None = Field(default=None, max_length=32)


class Track(BaseModel):
    position: int
    title: str = Field(max_length=255)
    duration: str = Field(default="", max_length=16)


class NamedLink(BaseModel):
    label: str = Field(max_length=64)
    url: str = Field(max_length=512)


class ArtBody(BaseModel):
    title: str = Field(max_length=255)
    subtitle: str = Field(default="", max_length=255)
    description: str = ""
    kind: str = Field(default="", max_length=32)
    label: str = Field(default="", max_length=128)
    releasedOn: date
    formats: list[str] = []
    coverUrl: str = Field(default="", max_length=512)
    bandcampAlbumId: str = Field(default="", max_length=32, pattern=r"^\d*$")
    catalogNumber: str = Field(default="", max_length=64)
    links: list[NamedLink] = []
    tracks: list[Track] = []


class ArtPatch(ArtBody):
    title: str | None = Field(default=None, max_length=255)
    releasedOn: date | None = None
    subtitle: str | None = None
    description: str | None = None
    kind: str | None = None
    label: str | None = None
    formats: list[str] | None = None
    coverUrl: str | None = None
    bandcampAlbumId: str | None = Field(default=None, max_length=32, pattern=r"^\d*$")
    catalogNumber: str | None = None
    links: list[NamedLink] | None = None
    tracks: list[Track] | None = None


class CvSectionBody(BaseModel):
    title: str = Field(max_length=128)
    kind: str = Field(default="", max_length=32)


class CvSectionPatch(BaseModel):
    title: str | None = Field(default=None, max_length=128)
    kind: str | None = Field(default=None, max_length=32)


class CvItemBody(BaseModel):
    title: str = Field(default="", max_length=255)
    subtitle: str = Field(default="", max_length=255)
    detail: str = ""
    period: str = Field(default="", max_length=64)


class CvItemPatch(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    subtitle: str | None = Field(default=None, max_length=255)
    detail: str | None = None
    period: str | None = Field(default=None, max_length=64)


class PostBody(BaseModel):
    slug: str = Field(max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(max_length=255)
    summary: str = ""
    body: str = ""
    coverUrl: str = Field(default="", max_length=512)
    language: str = Field(default="it", max_length=8)
    publishedOn: date
    draft: bool = False
    tags: list[str] = []


class PostPatch(BaseModel):
    slug: str | None = Field(default=None, max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = None
    body: str | None = None
    coverUrl: str | None = Field(default=None, max_length=512)
    language: str | None = Field(default=None, max_length=8)
    publishedOn: date | None = None
    draft: bool | None = None
    tags: list[str] | None = None


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class Reorder(BaseModel):
    ids: list[int]


# The one body a signed-out visitor may post. `scope` and `ref` are checked
# against what the site actually has in the endpoint, not here: a pattern can say
# the shape of a slug and cannot say that a post by that name exists.
class VisitBody(BaseModel):
    scope: str = Field(pattern=r"^(?:tab|post)$")
    ref: str = Field(max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
