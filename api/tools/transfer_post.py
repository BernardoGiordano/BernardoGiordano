"""Move one blog post, its tags and its images from one database to another.

  export <slug> <dir>   write the post, its tags, its media rows and the WebP
                        files it references into <dir>
  import <dir>          apply that directory to whatever DB_* currently points at

Both halves read the environment the application reads, so the direction is
chosen by which .env is sourced rather than by a flag.

The media rows travel with the post because the URLs in the body are the ones
`media.store` minted at upload time: `YYYY/MM/<sha256[:32]>`. Re-uploading the
WebP files on the far side would hash the re-encoded bytes rather than the
original and mint different paths, so every link in the body would have to be
rewritten. Copying the rows and the files verbatim keeps the body untouched.

Idempotent on both keys the schema already declares unique: the post upserts on
`slug`, each image upserts on `digest`, and the tags are replaced wholesale.
"""

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config, db  # noqa: E402

POST_COLUMNS = (
    "slug", "title", "summary", "body", "cover_url",
    "language", "published_on", "draft", "reading_minutes",
)
MEDIA_COLUMNS = (
    "digest", "purpose", "base_path", "width", "height",
    "widths", "bytes", "original_name",
)

# Matches the URLs media.store mints, in the body and in cover_url alike.
BASE_PATH = re.compile(r"/media/(\d{4}/\d{2}/[0-9a-f]{32})")


def _referenced(post: dict) -> list:
    found = BASE_PATH.findall(post["body"]) + BASE_PATH.findall(post["cover_url"])
    return sorted(set(found))


def export(slug: str, target: Path):
    with db.connect() as connection:
        post = db.one(
            connection,
            f"SELECT id, {', '.join(POST_COLUMNS)} FROM posts WHERE slug = %s",
            (slug,),
        )
        if post is None:
            raise SystemExit(f"no post with slug {slug}")

        tags = [row["tag"] for row in db.rows(connection, "SELECT tag FROM post_tags WHERE post_id = %s ORDER BY tag", (post["id"],))]

        bases = _referenced(post)
        media = []
        if bases:
            placeholders = ", ".join(["%s"] * len(bases))
            media = db.rows(
                connection,
                f"SELECT {', '.join(MEDIA_COLUMNS)} FROM media WHERE base_path IN ({placeholders}) ORDER BY base_path",
                tuple(bases),
            )

    known = {row["base_path"] for row in media}
    for base in bases:
        if base not in known:
            raise SystemExit(f"{base} is linked from the post but has no media row")

    files = target / "media"
    files.mkdir(parents=True, exist_ok=True)
    written = 0
    for row in media:
        for width in db.as_list(row["widths"]):
            name = f"{row['base_path']}-{width}.webp"
            source = config.MEDIA_ROOT / name
            if not source.is_file():
                raise SystemExit(f"{source} is missing")
            destination = files / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            written += 1

    post.pop("id")
    post["published_on"] = str(post["published_on"])
    for row in media:
        row["widths"] = db.as_list(row["widths"])

    payload = {"post": post, "tags": tags, "media": media}
    (target / "post.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    print(f"{slug}: {len(tags)} tags, {len(media)} images, {written} files under {target}")


def import_(source: Path):
    payload = json.loads((source / "post.json").read_text("utf-8"))
    post, tags, media = payload["post"], payload["tags"], payload["media"]

    # The files land before the rows: a row visible to a request whose image is
    # not on disk yet is a broken page, and the other order is only a row that
    # arrives a moment late.
    copied = 0
    for row in media:
        for width in row["widths"]:
            name = f"{row['base_path']}-{width}.webp"
            origin = source / "media" / name
            if not origin.is_file():
                raise SystemExit(f"{origin} is missing from the bundle")
            destination = config.MEDIA_ROOT / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, destination)
            copied += 1

    with db.connect() as connection:
        for row in media:
            db.execute(
                connection,
                f"""INSERT INTO media ({', '.join(MEDIA_COLUMNS)})
                    VALUES ({', '.join(['%s'] * len(MEDIA_COLUMNS))})
                    ON DUPLICATE KEY UPDATE base_path = VALUES(base_path), width = VALUES(width),
                      height = VALUES(height), widths = VALUES(widths), bytes = VALUES(bytes)""",
                tuple(db.dumps(row[column]) if column == "widths" else row[column] for column in MEDIA_COLUMNS),
            )

        assignments = ", ".join(f"{column} = VALUES({column})" for column in POST_COLUMNS if column != "slug")
        db.execute(
            connection,
            f"""INSERT INTO posts ({', '.join(POST_COLUMNS)})
                VALUES ({', '.join(['%s'] * len(POST_COLUMNS))})
                ON DUPLICATE KEY UPDATE {assignments}""",
            tuple(post[column] for column in POST_COLUMNS),
        )
        row = db.one(connection, "SELECT id FROM posts WHERE slug = %s", (post["slug"],))
        post_id = row["id"]

        db.execute(connection, "DELETE FROM post_tags WHERE post_id = %s", (post_id,))
        for tag in tags:
            db.execute(connection, "INSERT INTO post_tags (post_id, tag) VALUES (%s, %s)", (post_id, tag))

    print(f"{post['slug']}: post {post_id}, {len(tags)} tags, {len(media)} images, {copied} files into {config.MEDIA_ROOT}")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "export" and len(sys.argv) == 4:
        export(sys.argv[2], Path(sys.argv[3]))
    elif command == "import" and len(sys.argv) == 3:
        import_(Path(sys.argv[2]))
    else:
        print(__doc__)
        raise SystemExit(2)
