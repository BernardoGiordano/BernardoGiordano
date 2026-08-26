import re
from datetime import date, datetime, timedelta, timezone

import httpx

from . import config, db, github

# Downloads that never went through a GitHub release. A library is installed, not
# downloaded from a releases page, and an image is pulled — so for the projects
# that ship one, the registry holds the only number that means anything and
# `github_stats.downloads` is either zero or a rounding error.
#
# Its own cache table beside `github_stats`, keyed by (registry, name) rather
# than by repo, because the two are not the same thing: one repository can
# publish several packages, and a package can outlive the repository it was built
# from.

NPM_API = "https://api.npmjs.org"
NPM_REGISTRY = "https://registry.npmjs.org"
DOCKERHUB_API = "https://hub.docker.com/v2"

REGISTRIES = ("npm", "dockerhub")

# `@scope/name` or `name`. npm's own rule is longer than this — it also forbids
# leading dots, uppercase and a handful of reserved words — but a name this
# accepts and npm does not simply 404s, whereas anything looser would let a
# stored value choose the path of a request.
NPM_NAME = re.compile(r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$")

# `namespace/name`, which is what Docker Hub's API takes. An official image is
# `library/nginx`: the short form `nginx` is a display convenience of the client
# and not an address this endpoint answers to.
DOCKER_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$")

# The downloads range endpoint refuses a window wider than 18 months, and answers
# a wider one with a page of zeros rather than an error — which is worth knowing,
# because a walk that asked for one span would read as a package nobody installs.
CHUNK_DAYS = 540

# How far back the walk is willing to go: eight chunks is about twelve years,
# which is older than the registry's own download service. It is a stop for a
# package whose history has an 18-month hole in it, not a real horizon.
MAX_CHUNKS = 8


def valid(registry: str, name: str) -> bool:
    if registry == "npm":
        return bool(NPM_NAME.match(name))
    if registry == "dockerhub":
        return bool(DOCKER_NAME.match(name))
    return False


def _now():
    """Naive UTC, matching the DATETIME columns. The same reason `github._now`
    exists: `utcnow()` is deprecated and this has to run on whatever the server
    has."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ensure_row(connection, registry: str, name: str) -> None:
    """A placeholder so the projects join has something to hit before the first
    poll, and so the poller has a work list it can read from one table."""
    if not valid(registry, name):
        return
    db.execute(
        connection,
        "INSERT INTO package_stats (registry, name) VALUES (%s, %s) ON DUPLICATE KEY UPDATE name = name",
        (registry, name),
    )


def _headers() -> dict:
    return {"Accept": "application/json", "User-Agent": "santella.dev"}


def _npm_downloads(client: httpx.Client, name: str) -> int | None:
    """Every install npm will still answer for, walked backwards in 18-month
    chunks.

    There is no all-time endpoint. `downloads/point/{period}` knows three periods,
    the longest of which is a month, and `downloads/range` caps a window at 18
    months and returns zeros rather than an error for anything wider. So the
    total is a sum of windows, and the walk stops at the first one that is empty:
    before a package was published every day is a zero and stays one.

    The cost is one request per 18 months of history, which for a package
    published this year is one — and the walk stopping early is the reason it is
    not eight for every package on the site.

    A package dormant for a full 18 months and then revived would have its older
    half cut off here. That is the trade for not fetching the packument, which
    for a popular name is megabytes of version metadata to read one date out of.
    """
    total = 0
    end = date.today()

    for _ in range(MAX_CHUNKS):
        start = end - timedelta(days=CHUNK_DAYS)
        response = client.get(
            f"{NPM_API}/downloads/range/{start.isoformat()}:{end.isoformat()}/{name}",
            headers=_headers(),
        )
        if response.status_code == 404:
            # Only the first chunk can mean "no such package"; a later one cannot,
            # because the endpoint answers for a name it has already answered for.
            return None if total == 0 else total
        if response.status_code != 200:
            return None if total == 0 else total

        days = response.json().get("downloads") or []
        chunk = sum(int(day.get("downloads") or 0) for day in days)
        total += chunk
        if chunk == 0:
            break
        end = start - timedelta(days=1)

    return total


def _docker_pulls(client: httpx.Client, name: str) -> int | None:
    """`pull_count`, which unlike npm's figure is genuinely all-time and arrives
    in one unauthenticated request."""
    response = client.get(f"{DOCKERHUB_API}/repositories/{name}/", headers=_headers())
    if response.status_code != 200:
        return None
    return int(response.json().get("pull_count") or 0)


FETCH = {"npm": _npm_downloads, "dockerhub": _docker_pulls}


def refresh_package(connection, registry: str, name: str, force: bool = False) -> bool:
    """Poll one package. Returns whether anything was written.

    A failure is recorded in `last_error` and leaves the previous number in
    place, the same bargain `github.refresh_repo` makes: a registry having a bad
    afternoon should show yesterday's count, not a blank chip.
    """
    if not valid(registry, name):
        return False

    row = db.one(
        connection,
        "SELECT refreshed_at FROM package_stats WHERE registry = %s AND name = %s",
        (registry, name),
    )
    if row is None:
        ensure_row(connection, registry, name)
    elif not force and row["refreshed_at"] is not None:
        if _now() - row["refreshed_at"] < timedelta(hours=config.PACKAGE_REFRESH_HOURS):
            return False

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            downloads = FETCH[registry](client, name)
    except httpx.HTTPError as cause:
        db.execute(
            connection,
            "UPDATE package_stats SET last_error = %s WHERE registry = %s AND name = %s",
            (str(cause)[:255], registry, name),
        )
        return False

    if downloads is None:
        db.execute(
            connection,
            "UPDATE package_stats SET last_error = %s WHERE registry = %s AND name = %s",
            ("registry did not answer", registry, name),
        )
        return False

    db.execute(
        connection,
        """UPDATE package_stats SET downloads = %s, refreshed_at = %s, last_error = NULL
           WHERE registry = %s AND name = %s""",
        (downloads, _now(), registry, name),
    )
    return True


def refresh_all(force: bool = False) -> dict:
    """Every package any project declares. Unlike the GitHub sweep this is one
    request per package and there are a handful of them, so there is no listing
    step and nothing to rate-limit against."""
    with db.connect() as connection:
        declared = db.rows(
            connection,
            """SELECT DISTINCT package_registry AS registry, package_name AS name
               FROM projects WHERE package_name <> '' AND package_registry <> ''""",
        )
        for package in declared:
            ensure_row(connection, package["registry"], package["name"])

        # A project that dropped its package, or renamed it, leaves a row here
        # that nothing reads and that `site_totals` would go on adding up. The
        # project list is the source of truth for which packages the site claims,
        # so it is also the source of truth for what this table may hold.
        if declared:
            pairs = ", ".join(["(%s, %s)"] * len(declared))
            params = [value for package in declared for value in (package["registry"], package["name"])]
            db.execute(
                connection,
                f"DELETE FROM package_stats WHERE (registry, name) NOT IN ({pairs})",
                params,
            )
        else:
            db.execute(connection, "DELETE FROM package_stats")

    written = 0
    for package in declared:
        with db.connect() as connection:
            if refresh_package(connection, package["registry"], package["name"], force=force):
                written += 1

    return {"packages": len(declared), "written": written}


def site_totals(connection) -> dict:
    """The tab bar's two numbers, with a registry standing in for GitHub wherever
    a project declares one.

    Substitution and not addition. A project that publishes to npm usually also
    tags releases, and counting both would report the same work twice — so a
    repository named by a project with a package is left out of the GitHub sum
    and the package's figure is added in its place. That is the same rule the
    cards apply, and the two numbers agreeing with the chips under them is the
    whole point.

    `downloads_override` still does not enter into it. An override is one card's
    correction for something no registry counts; a package is a fact about the
    account, which is what these numbers are for.
    """
    stars = db.one(
        connection,
        """SELECT COALESCE(SUM(stars), 0) AS stars, COUNT(*) AS repos, MAX(refreshed_at) AS refreshed_at
           FROM owned_repos WHERE is_fork = 0""",
    )
    from_github = db.one(
        connection,
        """SELECT COALESCE(SUM(o.downloads), 0) AS downloads
           FROM owned_repos o
           WHERE o.is_fork = 0
             AND NOT EXISTS (SELECT 1 FROM projects p
                             WHERE p.repo = o.full_name AND p.repo <> '' AND p.package_name <> '')""",
    )
    # Keyed off `package_stats` rather than off `projects` so that two projects
    # naming the same package add it up once.
    from_registries = db.one(
        connection,
        """SELECT COALESCE(SUM(s.downloads), 0) AS downloads, MAX(s.refreshed_at) AS refreshed_at
           FROM package_stats s
           WHERE EXISTS (SELECT 1 FROM projects p
                         WHERE p.package_registry = s.registry AND p.package_name = s.name)""",
    )

    stamps = [stars["refreshed_at"], from_registries["refreshed_at"]]
    stamps = [stamp for stamp in stamps if stamp is not None]

    return {
        # SUM answers with a Decimal, which json cannot serialise and which no
        # caller wants: these are counts.
        "stars": int(stars["stars"] or 0),
        "downloads": int(from_github["downloads"] or 0) + int(from_registries["downloads"] or 0),
        "repos": int(stars["repos"] or 0),
        # The older of the two, because the pair is only as fresh as its stalest
        # half and a stamp that claimed otherwise would be the wrong reassurance.
        "refreshed_at": min(stamps) if stamps else None,
    }


def url(registry: str, name: str) -> str:
    """Where a reader goes to see the package the number came from."""
    if registry == "npm":
        return f"https://www.npmjs.com/package/{name}"
    if registry == "dockerhub":
        namespace, _, image = name.partition("/")
        if namespace == "library":
            return f"https://hub.docker.com/_/{image}"
        return f"https://hub.docker.com/r/{name}"
    return ""


# Re-exported so `manage.py` and the poller have one import for "go and fetch the
# numbers", rather than each knowing that there are two pollers.
def refresh_everything(force: bool = False) -> dict:
    result = github.refresh_all(force=force)
    result["packages"] = refresh_all(force=force)
    return result
