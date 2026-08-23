from fastapi import APIRouter, Depends, HTTPException

from .. import db, github
from ..auth import require_writer
from ..models import ProjectBody, ProjectPatch, Reorder, project_json

router = APIRouter(prefix="/api/projects", tags=["projects"])

COLUMNS = {
    "name": "name",
    "description": "description",
    "url": "url",
    "repo": "repo",
    "kind": "kind",
    "role": "role",
    "status": "status",
    "openSource": "open_source",
    "featured": "featured",
    "platforms": "platforms",
    "tech": "tech",
    "downloadsOverride": "downloads_override",
}

JSON_FIELDS = {"platforms", "tech"}


def _load(connection):
    """One query, left-joined: the stats table is a cache keyed by repo, so a
    project with no repo and a repo never polled both come back as null stats
    rather than as a missing row the caller has to notice."""
    return db.rows(
        connection,
        """SELECT p.*, g.repo AS g_repo, g.stars, g.forks, g.downloads, g.language, g.license,
                  g.last_release_tag, g.last_release_at, g.first_commit_at, g.refreshed_at
           FROM projects p LEFT JOIN github_stats g ON g.repo = p.repo AND p.repo <> ''
           ORDER BY p.position, p.id""",
    )


def _split(row):
    stats = {
        "repo": row["g_repo"],
        "stars": row["stars"],
        "forks": row["forks"],
        "downloads": row["downloads"],
        "language": row["language"],
        "license": row["license"],
        "last_release_tag": row["last_release_tag"],
        "last_release_at": row["last_release_at"],
        "first_commit_at": row["first_commit_at"],
        "refreshed_at": row["refreshed_at"],
    }
    return project_json(row, stats)


@router.get("")
def list_projects():
    with db.connect() as connection:
        return {"rows": [_split(row) for row in _load(connection)]}


def _one(connection, project_id: int):
    rows = [row for row in _load(connection) if row["id"] == project_id]
    if not rows:
        raise HTTPException(status_code=404, detail="no_such_project")
    return _split(rows[0])


def _values(fields):
    return [db.dumps(value) if key in JSON_FIELDS else value for key, value in fields.items()]


@router.post("", status_code=201)
def create_project(body: ProjectBody, _=Depends(require_writer)):
    with db.connect() as connection:
        nxt = db.one(connection, "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM projects")
        project_id = db.execute(
            connection,
            """INSERT INTO projects
               (name, description, url, repo, kind, role, status, open_source, featured,
                platforms, tech, downloads_override, position)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                body.name, body.description, body.url, body.repo, body.kind, body.role, body.status,
                body.openSource, body.featured, db.dumps(body.platforms), db.dumps(body.tech),
                body.downloadsOverride, nxt["next"],
            ),
        )
        if body.repo:
            github.ensure_row(connection, body.repo)
        return _one(connection, project_id)


@router.put("/{project_id}")
def update_project(project_id: int, patch: ProjectPatch, _=Depends(require_writer)):
    fields = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if k in COLUMNS}
    with db.connect() as connection:
        if fields:
            assignments = ", ".join(f"{COLUMNS[key]} = %s" for key in fields)
            db.execute(
                connection,
                f"UPDATE projects SET {assignments} WHERE id = %s",
                [*_values(fields), project_id],
            )
            if fields.get("repo"):
                github.ensure_row(connection, fields["repo"])
        return _one(connection, project_id)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM projects WHERE id = %s", (project_id,))


@router.post("/reorder")
def reorder(body: Reorder, _=Depends(require_writer)):
    with db.connect() as connection:
        db.many(
            connection,
            "UPDATE projects SET position = %s WHERE id = %s",
            [(index, project_id) for index, project_id in enumerate(body.ids)],
        )
        return {"rows": [_split(row) for row in _load(connection)]}


@router.post("/{project_id}/refresh")
def refresh(project_id: int, _=Depends(require_writer)):
    with db.connect() as connection:
        row = db.one(connection, "SELECT repo FROM projects WHERE id = %s", (project_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="no_such_project")
        if row["repo"]:
            github.refresh_repo(connection, row["repo"], force=True)
        return _one(connection, project_id)
