from fastapi import APIRouter, Depends, HTTPException

from .. import db, media
from ..auth import require_writer
from ..models import ArtBody, ArtPatch, art_json

router = APIRouter(prefix="/api/art", tags=["art"])

COLUMNS = {
    "title": "title",
    "subtitle": "subtitle",
    "description": "description",
    "kind": "kind",
    "label": "label",
    "releasedOn": "released_on",
    "formats": "formats",
    "coverUrl": "cover_url",
    "bandcampAlbumId": "bandcamp_album_id",
    "catalogNumber": "catalog_number",
    "links": "links",
    "tracks": "tracks",
}

JSON_FIELDS = {"formats", "links", "tracks"}

ORDER = "ORDER BY released_on DESC, position, id"


def _one(connection, art_id: int):
    row = db.one(connection, "SELECT * FROM art_works WHERE id = %s", (art_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="no_such_work")
    return art_json(row, media.srcset(connection, row["cover_url"]))


def _encode(key, value):
    if key not in JSON_FIELDS:
        return value
    return db.dumps([item if isinstance(item, dict) else item for item in value])


@router.get("")
def list_art():
    with db.connect() as connection:
        rows = db.rows(connection, f"SELECT * FROM art_works {ORDER}")
        sets = media.srcsets(connection, [row["cover_url"] for row in rows])
        return {"rows": [art_json(row, sets.get(row["cover_url"], "")) for row in rows]}


@router.post("", status_code=201)
def create_art(body: ArtBody, _=Depends(require_writer)):
    with db.connect() as connection:
        nxt = db.one(connection, "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM art_works")
        art_id = db.execute(
            connection,
            """INSERT INTO art_works
               (title, subtitle, description, kind, label, released_on, formats, cover_url,
                bandcamp_album_id, catalog_number, links, tracks, position)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                body.title, body.subtitle, body.description, body.kind, body.label, body.releasedOn,
                db.dumps(body.formats), body.coverUrl, body.bandcampAlbumId, body.catalogNumber,
                db.dumps([link.model_dump() for link in body.links]),
                db.dumps([track.model_dump() for track in body.tracks]),
                nxt["next"],
            ),
        )
        return _one(connection, art_id)


@router.put("/{art_id}")
def update_art(art_id: int, patch: ArtPatch, _=Depends(require_writer)):
    fields = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if k in COLUMNS}
    with db.connect() as connection:
        if fields:
            assignments = ", ".join(f"{COLUMNS[key]} = %s" for key in fields)
            values = [_encode(key, value) for key, value in fields.items()]
            db.execute(connection, f"UPDATE art_works SET {assignments} WHERE id = %s", [*values, art_id])
        return _one(connection, art_id)


@router.delete("/{art_id}", status_code=204)
def delete_art(art_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM art_works WHERE id = %s", (art_id,))
