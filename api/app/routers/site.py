from fastapi import APIRouter, Depends, HTTPException

from .. import db, media, packages, seo
from ..auth import require_writer
from ..models import LinkBody, LinkPatch, ProfilePatch, Reorder, link_json, profile_json, totals_json

router = APIRouter(prefix="/api", tags=["site"])

PROFILE_COLUMNS = {
    "name": "name",
    "headline": "headline",
    "bio": "bio",
    "location": "location",
    "current": "`current`",
    "now": "now_text",
    "available": "available",
    "email": "email",
    "avatarUrl": "avatar_url",
}


def _profile(connection):
    return db.one(connection, "SELECT * FROM profile WHERE id = 1")


@router.get("/site")
def site():
    """The shell in one request: a profile and the links under it are never
    rendered apart, so they are never fetched apart.

    The totals ride along for the same reason. They belong to the tab bar, which
    is on every page, and they used to be the project list added up on the client
    — which meant every page loaded the whole project list to print two numbers,
    and printed the wrong two, because the list is a curation and the numbers are
    supposed to be the whole of the work."""
    with db.connect() as connection:
        profile = _profile(connection)
        links = db.rows(connection, "SELECT * FROM links ORDER BY position, id")
        return {
            "profile": profile_json(profile, media.srcset(connection, profile["avatar_url"])),
            "links": [link_json(row) for row in links],
            "totals": totals_json(packages.site_totals(connection)),
        }


@router.put("/profile")
def update_profile(patch: ProfilePatch, _=Depends(require_writer)):
    fields = patch.model_dump(exclude_unset=True)
    with db.connect() as connection:
        if fields:
            assignments = ", ".join(f"{PROFILE_COLUMNS[key]} = %s" for key in fields if key in PROFILE_COLUMNS)
            values = [fields[key] for key in fields if key in PROFILE_COLUMNS]
            if assignments:
                db.execute(connection, f"UPDATE profile SET {assignments} WHERE id = 1", values)
        row = _profile(connection)
        answer = profile_json(row, media.srcset(connection, row["avatar_url"]))

    # The name and the headline are the shell document's title and description on
    # every URL, and that document is rendered once and kept. Editing the profile
    # is the one write that changes all of them at once. After the commit, so a
    # render racing this one cannot repopulate the cache from the old rows.
    seo.forget_shells()
    return answer


@router.post("/links", status_code=201)
def create_link(body: LinkBody, _=Depends(require_writer)):
    with db.connect() as connection:
        row = db.one(connection, "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM links")
        link_id = db.execute(
            connection,
            "INSERT INTO links (kind, label, url, position) VALUES (%s, %s, %s, %s)",
            (body.kind, body.label, body.url, row["next"]),
        )
        return link_json(db.one(connection, "SELECT * FROM links WHERE id = %s", (link_id,)))


@router.put("/links/{link_id}")
def update_link(link_id: int, patch: LinkPatch, _=Depends(require_writer)):
    fields = patch.model_dump(exclude_unset=True)
    with db.connect() as connection:
        if fields:
            assignments = ", ".join(f"{key} = %s" for key in fields)
            db.execute(connection, f"UPDATE links SET {assignments} WHERE id = %s", [*fields.values(), link_id])
        row = db.one(connection, "SELECT * FROM links WHERE id = %s", (link_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="no_such_link")
        return link_json(row)


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM links WHERE id = %s", (link_id,))


@router.post("/links/reorder")
def reorder_links(body: Reorder, _=Depends(require_writer)):
    with db.connect() as connection:
        db.many(
            connection,
            "UPDATE links SET position = %s WHERE id = %s",
            [(index, link_id) for index, link_id in enumerate(body.ids)],
        )
        return [link_json(row) for row in db.rows(connection, "SELECT * FROM links ORDER BY position, id")]
