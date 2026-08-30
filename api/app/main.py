import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, packages, seo
from .routers import art, cv, posts, projects, session, site, upload, visits

log = logging.getLogger("santella")

SPA_PATHS = ("/projects", "/art", "/cv", "/blog")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    poller = asyncio.create_task(_poll_forever())
    try:
        yield
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller


async def _poll_forever():
    """GitHub and registry stats, in this process rather than in cron: one
    deployment unit, and every half of `refresh_everything` already refuses to
    poll something it polled recently, so the loop interval is a floor and not a schedule anything depends
    on. That guard is what keeps a run of deploys — supervisor restarts the
    process, and the first thing it does is come through here — from spending the
    hour's whole GitHub allowance on sweeps nobody asked for."""
    while True:
        try:
            result = await asyncio.to_thread(packages.refresh_everything)
            noisy = result["written"] or result["packages"]["written"]
            if noisy or any(not owner["skipped"] for owner in result["owners"]):
                log.info("stats refreshed: %s", result)
        except Exception:
            log.exception("stats refresh failed")
        await asyncio.sleep(config.GITHUB_REFRESH_HOURS * 3600)


app = FastAPI(title="santella.dev", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

app.include_router(session.router)
app.include_router(site.router)
app.include_router(projects.router)
app.include_router(art.router)
app.include_router(cv.router)
app.include_router(posts.router)
app.include_router(upload.router)
app.include_router(visits.router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


# The build declares a Cache-Control for every file it emits and nginx is generated
# from that declaration. These are the responses no artifact describes — /api,
# /auth, the three SEO files and, in development, the shell and the upload tree —
# and until now they declared nothing at all, which left every one of them to a
# browser heuristic. They are stated here rather than in nginx because in
# development this process is the whole stack with no nginx in front of it, and
# because a policy belongs with the response it describes. The edge hides the
# upstream's copy on the one path where it states its own.
#
# /api reads are cached for a minute, not `no-store`: the numbers behind them come
# from a poller that refreshes on the order of hours, so a read that is one minute
# behind is already the shape of the data. `private` and `Vary: Cookie` because the
# same URL answers differently for the signed-in owner — GET /api/posts includes
# drafts and GET /api/visits is owner-only — so signing in or out must miss the
# cache rather than reuse the other answer.
API_READ = "private, max-age=60"
NO_STORE = "no-store"
FEED = "public, max-age=3600"
ROBOTS = "public, max-age=86400"
DOCUMENT = "private, no-cache"
IMMUTABLE = "public, max-age=31536000, immutable"


def cache_control(path: str, method: str) -> tuple[str, bool]:
    """The header for one response, and whether it varies by cookie."""
    if path.startswith("/auth/"):
        return NO_STORE, False
    if path.startswith("/api/"):
        if method in ("GET", "HEAD"):
            return API_READ, True
        return NO_STORE, False
    if path in ("/feed.xml", "/sitemap.xml"):
        return FEED, False
    if path == "/robots.txt":
        return ROBOTS, False
    if path.startswith(f"{config.MEDIA_URL}/"):
        return IMMUTABLE, False
    return DOCUMENT, False


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    value, by_cookie = cache_control(request.url.path, request.method)
    response.headers.setdefault("Cache-Control", value)
    if by_cookie:
        response.headers.setdefault("Vary", "Cookie")
    return response


@app.get("/feed.xml")
def rss():
    return Response(seo.feed(), media_type="application/rss+xml; charset=utf-8")


@app.get("/sitemap.xml")
def sitemap():
    return Response(seo.sitemap(), media_type="application/xml; charset=utf-8")


@app.get("/robots.txt")
def robots():
    return PlainTextResponse(f"User-agent: *\nAllow: /\nSitemap: {config.SITE_ORIGIN}/sitemap.xml\n")


if config.MEDIA_ROOT.exists():
    app.mount(config.MEDIA_URL, StaticFiles(directory=config.MEDIA_ROOT), name="media")


# Development shape only: with WEB_ROOT set this process also serves the SPA, so
# `uvicorn app.main:app` is the whole stack. In production nginx owns the static
# tree and reverse-proxies only /api, /auth and /media here.
if config.WEB_ROOT is not None:

    @app.get("/{path:path}")
    def shell(path: str, request: Request):
        candidate = (config.WEB_ROOT / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(config.WEB_ROOT):
            return FileResponse(candidate)

        index = config.WEB_ROOT / "index.html"
        return Response(
            seo.render_shell(index.read_text("utf-8"), request.url.path),
            media_type="text/html; charset=utf-8",
        )
