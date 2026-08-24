import os
import secrets
from pathlib import Path

DB = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "user": os.environ.get("DB_USER", "santella"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "santella"),
}

MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "./media")).resolve()
MEDIA_URL = os.environ.get("MEDIA_URL", "/media")

SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "http://localhost:8000")
SITE_TITLE = os.environ.get("SITE_TITLE", "Bernardo Giordano")

# Off only for http://localhost: a Secure cookie is never stored over plain HTTP,
# which looks exactly like a broken login. Anything else must set it.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
COOKIE_NAME = "sid"
SESSION_TTL_HOURS = int(os.environ.get("SESSION_TTL_HOURS", "168"))

# The window the browser is told the session is good for. Shorter than the real
# TTL so srl's AuthSession refreshes and the cookie's last_seen_at keeps moving.
SESSION_WINDOW_MINUTES = int(os.environ.get("SESSION_WINDOW_MINUTES", "30"))

LOGIN_MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "10"))
LOGIN_WINDOW_MINUTES = int(os.environ.get("LOGIN_WINDOW_MINUTES", "15"))

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REFRESH_HOURS = int(os.environ.get("GITHUB_REFRESH_HOURS", "6"))

# The accounts the site's two totals add up. Not the project list: that is a
# curation of five or six things worth a paragraph each, and the numbers in the
# tab bar are meant to be the whole of the work — which is currently 38
# repositories across a personal account and an organisation.
#
# A sweep of these costs one listing request per account plus one per non-fork
# repository, so it is the expensive half of the poller and the reason a
# GITHUB_TOKEN stops being optional: the unauthenticated allowance is 60 requests
# an hour and a sweep is most of it.
GITHUB_OWNERS = tuple(
    owner.strip()
    for owner in os.environ.get("GITHUB_OWNERS", "BernardoGiordano,FlagBrew").split(",")
    if owner.strip()
)

# How long one reader counts as the same reader. A refresh, the back button and
# the second tab they opened are one visit; coming back tomorrow is another.
VISIT_WINDOW_HOURS = int(os.environ.get("VISIT_WINDOW_HOURS", "6"))

# Salts the digest that stands in for a visitor in visit_marks. No address is
# stored anywhere -- the digest is the whole record -- and a salt nobody else
# knows is what stops that digest from being a lookup table anyone with a dump
# could walk back to an address. Unset means one made up at startup: deduplication
# then restarts with the process, which costs a handful of double counts per
# deploy and nothing else.
VISIT_SALT = os.environ.get("VISIT_SALT") or secrets.token_hex(32)

UPLOAD_MAX_BYTES = int(os.environ.get("UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))
IMAGE_WIDTHS = (480, 960, 1600)
IMAGE_QUALITY = int(os.environ.get("IMAGE_QUALITY", "82"))

# Serving the SPA from this process is the development shape. In production nginx
# owns the static tree and only /api, /auth and /media reach here.
WEB_ROOT = Path(os.environ["WEB_ROOT"]).resolve() if os.environ.get("WEB_ROOT") else None
