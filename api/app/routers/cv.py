from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import require_writer
from ..models import CvItemBody, CvItemPatch, CvSectionBody, CvSectionPatch, Reorder, cv_section_json

router = APIRouter(prefix="/api/cv", tags=["cv"])


def _sections(connection):
    sections = db.rows(connection, "SELECT * FROM cv_sections ORDER BY position, id")
    items = db.rows(connection, "SELECT * FROM cv_items ORDER BY section_id, position, id")
    grouped = {}
    for item in items:
        grouped.setdefault(item["section_id"], []).append(item)
    return [cv_section_json(section, grouped.get(section["id"], [])) for section in sections]


def _section(connection, section_id: int):
    for section in _sections(connection):
        if section["id"] == section_id:
            return section
    raise HTTPException(status_code=404, detail="no_such_section")


@router.get("")
def list_cv():
    with db.connect() as connection:
        return {"sections": _sections(connection)}


@router.post("/sections", status_code=201)
def create_section(body: CvSectionBody, _=Depends(require_writer)):
    with db.connect() as connection:
        nxt = db.one(connection, "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cv_sections")
        db.execute(
            connection,
            "INSERT INTO cv_sections (title, kind, position) VALUES (%s, %s, %s)",
            (body.title, body.kind, nxt["next"]),
        )
        return {"sections": _sections(connection)}


@router.put("/sections/{section_id}")
def update_section(section_id: int, patch: CvSectionPatch, _=Depends(require_writer)):
    fields = patch.model_dump(exclude_unset=True)
    with db.connect() as connection:
        if fields:
            assignments = ", ".join(f"{key} = %s" for key in fields)
            db.execute(connection, f"UPDATE cv_sections SET {assignments} WHERE id = %s", [*fields.values(), section_id])
        return _section(connection, section_id)


@router.delete("/sections/{section_id}")
def delete_section(section_id: int, _=Depends(require_writer)):
    """The items go with it: `cv_items.section_id` cascades, so a section is
    deleted as one thing rather than emptied first by the client."""
    with db.connect() as connection:
        if db.one(connection, "SELECT id FROM cv_sections WHERE id = %s", (section_id,)) is None:
            raise HTTPException(status_code=404, detail="no_such_section")
        db.execute(connection, "DELETE FROM cv_sections WHERE id = %s", (section_id,))
        return {"sections": _sections(connection)}


@router.post("/sections/reorder")
def reorder_sections(body: Reorder, _=Depends(require_writer)):
    with db.connect() as connection:
        db.many(
            connection,
            "UPDATE cv_sections SET position = %s WHERE id = %s",
            [(index, section_id) for index, section_id in enumerate(body.ids)],
        )
        return {"sections": _sections(connection)}


@router.post("/sections/{section_id}/items/reorder")
def reorder_items(section_id: int, body: Reorder, _=Depends(require_writer)):
    """Scoped to the section: an id from another one would otherwise be given a
    position inside this list and move a row the caller never named."""
    with db.connect() as connection:
        owned = {row["id"] for row in db.rows(connection, "SELECT id FROM cv_items WHERE section_id = %s", (section_id,))}
        ids = [item_id for item_id in body.ids if item_id in owned]
        if len(ids) != len(owned):
            raise HTTPException(status_code=400, detail="incomplete_order")
        db.many(
            connection,
            "UPDATE cv_items SET position = %s WHERE id = %s",
            [(index, item_id) for index, item_id in enumerate(ids)],
        )
        return _section(connection, section_id)


@router.post("/sections/{section_id}/items", status_code=201)
def create_item(section_id: int, body: CvItemBody, _=Depends(require_writer)):
    with db.connect() as connection:
        if db.one(connection, "SELECT id FROM cv_sections WHERE id = %s", (section_id,)) is None:
            raise HTTPException(status_code=404, detail="no_such_section")
        nxt = db.one(
            connection,
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cv_items WHERE section_id = %s",
            (section_id,),
        )
        db.execute(
            connection,
            "INSERT INTO cv_items (section_id, title, subtitle, detail, period, position) VALUES (%s, %s, %s, %s, %s, %s)",
            (section_id, body.title, body.subtitle, body.detail, body.period, nxt["next"]),
        )
        return _section(connection, section_id)


@router.put("/items/{item_id}")
def update_item(item_id: int, patch: CvItemPatch, _=Depends(require_writer)):
    fields = patch.model_dump(exclude_unset=True)
    with db.connect() as connection:
        row = db.one(connection, "SELECT section_id FROM cv_items WHERE id = %s", (item_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="no_such_item")
        if fields:
            assignments = ", ".join(f"{key} = %s" for key in fields)
            db.execute(connection, f"UPDATE cv_items SET {assignments} WHERE id = %s", [*fields.values(), item_id])
        return _section(connection, row["section_id"])


@router.delete("/items/{item_id}")
def delete_item(item_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        row = db.one(connection, "SELECT section_id FROM cv_items WHERE id = %s", (item_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="no_such_item")
        db.execute(connection, "DELETE FROM cv_items WHERE id = %s", (item_id,))
        return _section(connection, row["section_id"])
