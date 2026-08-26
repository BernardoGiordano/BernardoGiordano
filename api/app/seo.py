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


def _absolute(url: str) -> str:
    """A path the site serves, as an address a reader can fetch. A feed is read
    somewhere else by definition, so `/media/…` in it resolves against whatever
    host the reader happens to be on."""
    if url == "" or url.startswith(("http://", "https://")):
        return url
    return f"{config.SITE_ORIGIN}{url}"


def _element(name: str, value) -> str:
    return f"      <{name}>{escape(str(value))}</{name}>\n"


def feed() -> str:
    """RSS 2.0, with the two extensions every reader understands: `dc:creator`
    for the byline and Media RSS for the cover.

    Media RSS and not `<enclosure>`, which is the older spelling of the same
    idea: `enclosure` requires a byte length, and the length that is stored is
    the source image's rather than the WebP the site actually serves. A number
    that is wrong is worse than an element that is absent, and `media:content`
    asks for a type and a URL, both of which are known.

    Summaries and not full posts. `description` carries the summary the post
    already has, or its opening paragraph, because rendering the body would mean
    a Markdown implementation in this process that agrees with the one in the
    browser — and two renderers that disagree is a feed that quietly publishes
    something the site does not show.
    """
    with db.connect() as connection:
        profile = db.one(connection, "SELECT name, headline, bio, avatar_url FROM profile WHERE id = 1")
        posts = db.rows(
            connection,
            """SELECT id, slug, title, summary, body, language, cover_url, published_on, updated_at
               FROM posts WHERE draft = 0 ORDER BY published_on DESC, id DESC LIMIT 40""",
        )
        # One query for every tag in the feed rather than one per item: a
        # category list is the cheapest thing here and should not be forty round
        # trips.
        tagged = {}
        if posts:
            placeholders = ", ".join(["%s"] * len(posts))
            for row in db.rows(
                connection,
                f"SELECT post_id, tag FROM post_tags WHERE post_id IN ({placeholders}) ORDER BY tag",
                tuple(post["id"] for post in posts),
            ):
                tagged.setdefault(row["post_id"], []).append(row["tag"])

    title = profile["name"] or config.SITE_TITLE
    description = profile["headline"] or profile["bio"][:200] or title
    avatar = _absolute(profile["avatar_url"] or "")

    items = []
    for post in posts:
        link = f"{config.SITE_ORIGIN}/blog/{post['slug']}"
        stamp = datetime.combine(post["published_on"], datetime.min.time()).replace(tzinfo=timezone.utc)
        summary = post["summary"] or _first_paragraph(post["body"], 400)

        item = "    <item>\n"
        item += _element("title", post["title"])
        item += _element("link", link)
        item += f'      <guid isPermaLink="true">{escape(link)}</guid>\n'
        item += f"      <pubDate>{format_datetime(stamp)}</pubDate>\n"
        item += _element("dc:creator", title)
        # The tags the post carries, which on this blog are what a reader would
        # subscribe to a part of: a review, four stars, Ernst Jünger.
        for tag in tagged.get(post["id"], []):
            item += _element("category", tag)
        item += _element("description", summary)
        cover = _absolute(post["cover_url"])
        if cover:
            # Every cover is a WebP: media.store re-encodes whatever was uploaded,
            # so the type is known without reading the file.
            item += f'      <media:content url="{escape(cover)}" type="image/webp" medium="image" />\n'
        item += "    </item>"
        items.append(item)

    # The language of the writing, not of the interface. All fifty posts are in
    # Italian and an `en` here would tell a reader's language filter to hide
    # them; taking it from the posts means the day one is written in English the
    # channel stops claiming otherwise on its own.
    languages = [post["language"] for post in posts if post["language"]]
    language = max(set(languages), key=languages.count) if languages else "it"

    built = max((post["updated_at"] for post in posts), default=None)

    channel = "  <channel>\n"
    channel += f"    <title>{escape(title)}</title>\n"
    channel += f"    <link>{escape(config.SITE_ORIGIN)}</link>\n"
    channel += f"    <description>{escape(description)}</description>\n"
    channel += f"    <language>{escape(language)}</language>\n"
    channel += f'    <atom:link href="{escape(config.SITE_ORIGIN)}/feed.xml" rel="self" type="application/rss+xml" />\n'
    if built is not None:
        channel += f"    <lastBuildDate>{format_datetime(built.replace(tzinfo=timezone.utc))}</lastBuildDate>\n"
    # Six hours, matching nothing in particular except the rate at which this
    # site changes: a reader that honours it stops asking forty times a day.
    channel += "    <ttl>360</ttl>\n"
    channel += f"    <generator>{escape(config.SITE_TITLE)}</generator>\n"
    channel += "    <docs>https://www.rssboard.org/rss-specification</docs>\n"
    if avatar:
        channel += (
            "    <image>\n"
            f"      <url>{escape(avatar)}</url>\n"
            f"      <title>{escape(title)}</title>\n"
            f"      <link>{escape(config.SITE_ORIGIN)}</link>\n"
            "    </image>\n"
        )
    channel += "\n".join(items)
    channel += "\n  </channel>\n"

    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"\n'
        '     xmlns:dc="http://purl.org/dc/elements/1.1/"\n'
        '     xmlns:media="http://search.yahoo.com/mrss/">\n'
        + channel
        + "</rss>\n"
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
