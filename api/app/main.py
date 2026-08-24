import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, github, seo
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
    """GitHub stats, in this process rather than in cron: one deployment unit, and
    both halves of `refresh_all` already refuse to poll something they polled
    recently, so the loop interval is a floor and not a schedule anything depends
    on. That guard is what keeps a run of deploys — supervisor restarts the
    process, and the first thing it does is come through here — from spending the
    hour's whole GitHub allowance on sweeps nobody asked for."""
    while True:
        try:
            result = await asyncio.to_thread(github.refresh_all)
            if result["written"] or any(not owner["skipped"] for owner in result["owners"]):
                log.info("github stats refreshed: %s", result)
        except Exception:
            log.exception("github refresh failed")
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
