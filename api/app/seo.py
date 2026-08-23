import html
import re
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape

from . import config, db

# A client-rendered page has no <title> a crawler can read and no description a
# social card can quote. Rather than server-render the body, this injects the four
# tags that matter into the shell's <head> per URL, and serves the two documents
# a blog is expected to have.

TITLE = re.compile(r"<title>.*?</title>", re.S)
DESCRIPTION = re.compile(r'<meta name="description" content=".*?"\s*/?>', re.S)


def _meta(title: str, description: str, url: str, image: str | None) -> str:
    tags = [
        f'<meta property="og:title" content="{html.escape(title, quote=True)}" />',
        f'<meta property="og:description" content="{html.escape(description, quote=True)}" />',
        f'<meta property="og:url" content="{html.escape(url, quote=True)}" />',
        '<meta property="og:type" content="website" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ]
    if image:
        tags.append(f'<meta property="og:image" content="{html.escape(image, quote=True)}" />')
    return "\n    ".join(tags)


def _first_paragraph(markdown: str, limit: int = 200) -> str:
    for block in markdown.split("\n\n"):
        text = re.sub(r"[#*_>`\[\]!]|\(https?://[^)]*\)", "", block).strip()
        if text:
            return text[:limit].rstrip() + ("…" if len(text) > limit else "")
    return ""


def describe(path: str) -> tuple[str, str, str | None]:
    """Title, description and image for one URL. One query at most, and a miss
    falls back to the site's own description rather than failing the page."""
    with db.connect() as connection:
        profile = db.one(connection, "SELECT name, headline, bio, avatar_url FROM profile WHERE id = 1")
        site_title = profile["name"] or config.SITE_TITLE
        site_description = profile["headline"] or profile["bio"][:200]
        avatar = profile["avatar_url"] or None

        match = re.fullmatch(r"/blog/([A-Za-z0-9-]+)/?", path)
        if match is not None:
            post = db.one(
                connection,
                "SELECT title, summary, body, cover_url FROM posts WHERE slug = %s AND draft = 0",
                (match.group(1),),
            )
            if post is not None:
                summary = post["summary"] or _first_paragraph(post["body"])
                return f"{post['title']} — {site_title}", summary, post["cover_url"] or avatar

        section = {
            "/projects": "Projects",
            "/art": "Art",
            "/cv": "CV",
            "/blog": "Blog",
        }.get(path.rstrip("/") or "/projects")

        if section is not None:
            return f"{section} — {site_title}", site_description, avatar
        return site_title, site_description, avatar


def render_shell(shell: str, path: str) -> str:
    title, description, image = describe(path)
    url = f"{config.SITE_ORIGIN}{path}"

    shell = TITLE.sub(f"<title>{html.escape(title)}</title>", shell, count=1)
    shell = DESCRIPTION.sub(
        f'<meta name="description" content="{html.escape(description, quote=True)}" />',
        shell,
        count=1,
    )
    return shell.replace("</head>", f"  {_meta(title, description, url, image)}\n  </head>", 1)


def feed() -> str:
    with db.connect() as connection:
        profile = db.one(connection, "SELECT name, headline FROM profile WHERE id = 1")
        posts = db.rows(
            connection,
            """SELECT slug, title, summary, body, published_on, updated_at FROM posts
               WHERE draft = 0 ORDER BY published_on DESC, id DESC LIMIT 40""",
        )

    title = profile["name"] or config.SITE_TITLE
    items = []
    for post in posts:
        link = f"{config.SITE_ORIGIN}/blog/{post['slug']}"
        stamp = datetime.combine(post["published_on"], datetime.min.time()).replace(tzinfo=timezone.utc)
        summary = post["summary"] or _first_paragraph(post["body"], 400)
        items.append(
            "    <item>\n"
            f"      <title>{escape(post['title'])}</title>\n"
            f"      <link>{escape(link)}</link>\n"
            f"      <guid isPermaLink=\"true\">{escape(link)}</guid>\n"
            f"      <pubDate>{format_datetime(stamp)}</pubDate>\n"
            f"      <description>{escape(summary)}</description>\n"
            "    </item>"
        )

    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        f"    <title>{escape(title)}</title>\n"
        f"    <link>{escape(config.SITE_ORIGIN)}</link>\n"
        f"    <description>{escape(profile['headline'] or title)}</description>\n"
        f'    <atom:link href="{escape(config.SITE_ORIGIN)}/feed.xml" rel="self" type="application/rss+xml" />\n'
        + "\n".join(items)
        + "\n  </channel>\n</rss>\n"
    )


def sitemap() -> str:
    with db.connect() as connection:
        slugs = db.rows(
            connection,
            "SELECT slug, updated_at FROM posts WHERE draft = 0 ORDER BY published_on DESC",
        )

    urls = [f"{config.SITE_ORIGIN}{path}" for path in ("/projects", "/art", "/cv", "/blog")]
    entries = [f"  <url><loc>{escape(url)}</loc></url>" for url in urls]
    entries += [
        f"  <url><loc>{escape(config.SITE_ORIGIN)}/blog/{escape(row['slug'])}</loc>"
        f"<lastmod>{row['updated_at'].date().isoformat()}</lastmod></url>"
        for row in slugs
    ]
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
