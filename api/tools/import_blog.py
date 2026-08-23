"""Import the Hugo blog into MySQL.

  python tools/import_blog.py <hugo-repo> [--dry-run] [--limit N]

Frontmatter comes out with PyYAML, covers and inline images go through the same
media pipeline as an upload (so they are resized, converted and stripped of EXIF
exactly like anything added later), and body image references are rewritten to
the URLs that pipeline returns.

Slugs keep the Hugo filename. The old URLs are not redirected — that was a
decision, not an oversight — but a slug somebody bookmarked as a title still
resolves under /blog/.
"""

import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db, media  # noqa: E402
from app.routers.posts import reading_minutes  # noqa: E402

FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.S)
INLINE_IMAGE = re.compile(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)')

# Two files are not posts.
SKIP = {"search", "archives"}


def slugify(stem: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "post"


def first_paragraph(body: str, limit: int = 240) -> str:
    for block in body.split("\n\n"):
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", block)
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
        text = re.sub(r"</?[a-z][^>]*>", "", text)
        text = re.sub(r"[#*_>`]", "", text).strip()
        if len(text) > 40:
            return text[:limit].rstrip() + ("…" if len(text) > limit else "")
    return ""


def upload(static_root: Path, reference: str, cache: dict, dry_run: bool):
    """One static/img reference -> a media URL. Cached, because the same cover can
    appear in a body and in frontmatter and re-encoding it twice is waste."""
    relative = reference.split("img/", 1)[-1] if "img/" in reference else reference
    source = static_root / "img" / relative

    if reference in cache:
        return cache[reference]
    if not source.is_file():
        print(f"    missing image: {source}")
        cache[reference] = None
        return None
    if dry_run:
        cache[reference] = f"<{source.stat().st_size // 1024} KiB>"
        return cache[reference]

    stored = media.store(source.read_bytes(), "post", source.name)
    cache[reference] = stored["url"]
    return stored["url"]


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)

    hugo = Path(sys.argv[1]).resolve()
    dry_run = "--dry-run" in sys.argv
    limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)

    static_root = hugo / "static"
    files = sorted(p for p in (hugo / "content" / "posts").rglob("*.md") if p.stem not in SKIP)
    if limit:
        files = files[:limit]

    cache: dict = {}
    imported = skipped = 0

    for path in files:
        raw = path.read_text("utf-8")
        match = FRONTMATTER.match(raw)
        if match is None:
            print(f"  no frontmatter: {path.name}")
            skipped += 1
            continue

        meta = yaml.safe_load(match.group(1)) or {}
        body = match.group(2).strip()
        slug = slugify(path.stem)
        title = str(meta.get("title", path.stem)).strip()
        published = str(meta.get("date", ""))[:10]
        tags = [str(t).strip().lower() for t in (meta.get("tags") or []) if str(t).strip()]

        cover_ref = ((meta.get("cover") or {}) if isinstance(meta.get("cover"), dict) else {}).get("image", "")
        cover_url = upload(static_root, str(cover_ref), cache, dry_run) if cover_ref else None

        def rewrite(m: re.Match) -> str:
            alt, target, caption = m.group(1), m.group(2), m.group(3)
            if target.startswith(("http://", "https://", "/media/")):
                return m.group(0)
            url = upload(static_root, target, cache, dry_run)
            if url is None:
                return alt
            title_part = f' "{caption}"' if caption else ""
            return f"![{alt or caption or ''}]({url}{title_part})"

        body = INLINE_IMAGE.sub(rewrite, body)

        print(f"  {slug:<52} {published}  {len(tags)} tags  {'cover' if cover_url else 'no cover'}")

        if dry_run:
            imported += 1
            continue

        with db.connect() as connection:
            existing = db.one(connection, "SELECT id FROM posts WHERE slug = %s", (slug,))
            values = (
                title, first_paragraph(body), body, cover_url or "", "it",
                published, 0, reading_minutes(body),
            )
            if existing is None:
                post_id = db.execute(
                    connection,
                    """INSERT INTO posts (slug, title, summary, body, cover_url, language, published_on, draft, reading_minutes)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (slug, *values),
                )
            else:
                post_id = existing["id"]
                db.execute(
                    connection,
                    """UPDATE posts SET title = %s, summary = %s, body = %s, cover_url = %s, language = %s,
                              published_on = %s, draft = %s, reading_minutes = %s WHERE id = %s""",
                    (*values, post_id),
                )

            db.execute(connection, "DELETE FROM post_tags WHERE post_id = %s", (post_id,))
            if tags:
                db.many(
                    connection,
                    "INSERT INTO post_tags (post_id, tag) VALUES (%s, %s)",
                    [(post_id, tag[:64]) for tag in sorted(set(tags))],
                )
        imported += 1

    print(f"\n{imported} posts, {skipped} skipped, {len([v for v in cache.values() if v])} images")


if __name__ == "__main__":
    main()
