import re
from datetime import datetime, timedelta, timezone

import httpx

from . import config, db

API = "https://api.github.com"
REPO = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")


def ensure_row(connection, repo: str) -> None:
    """A placeholder so the projects join has something to hit before the first
    poll, and so the poller has a work list it can read from one table."""
    if not REPO.match(repo):
        return
    db.execute(
        connection,
        "INSERT INTO github_stats (repo) VALUES (%s) ON DUPLICATE KEY UPDATE repo = repo",
        (repo,),
    )


def _headers(etag: str | None = None) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "santella.dev",
    }
    if config.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {config.GITHUB_TOKEN}"
    if etag:
        headers["If-None-Match"] = etag
    return headers


def _now():
    """Naive UTC, matching the DATETIME columns. `utcnow()` is deprecated on newer
    interpreters and this has to run on whatever the server has."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _instant(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)


def _first_commit_at(client: httpx.Client, repo: str):
    """The oldest commit, in two requests rather than by paging the whole history:
    ask for one commit per page, read the Link header's last page, fetch that."""
    head = client.get(f"{API}/repos/{repo}/commits", params={"per_page": 1}, headers=_headers())
    if head.status_code != 200:
        return None

    link = head.headers.get("link", "")
    match = re.search(r'[?&]page=(\d+)>;\s*rel="last"', link)
    if match is None:
        payload = head.json()
        return _instant(payload[0]["commit"]["committer"]["date"]) if payload else None

    tail = client.get(
        f"{API}/repos/{repo}/commits",
        params={"per_page": 1, "page": match.group(1)},
        headers=_headers(),
    )
    if tail.status_code != 200:
        return None
    payload = tail.json()
    return _instant(payload[0]["commit"]["committer"]["date"]) if payload else None


def _release_totals(client: httpx.Client, repo: str):
    """Every asset of every release. Downloads are the headline number for the
    console homebrew, and GitHub reports them only per asset."""
    downloads = 0
    latest_tag = None
    latest_at = None
    page = 1

    while page <= 10:
        response = client.get(
            f"{API}/repos/{repo}/releases",
            params={"per_page": 100, "page": page},
            headers=_headers(),
        )
        if response.status_code != 200:
            break
        releases = response.json()
        if not releases:
            break
        for release in releases:
            for asset in release.get("assets", []):
                downloads += int(asset.get("download_count") or 0)
            published = _instant(release.get("published_at"))
            if published is not None and (latest_at is None or published > latest_at):
                latest_at, latest_tag = published, release.get("tag_name")
        if len(releases) < 100:
            break
        page += 1

    return downloads, latest_tag, latest_at


def refresh_repo(connection, repo: str, force: bool = False) -> bool:
    """Poll one repository. Returns whether anything was written.

    A failure is recorded in `last_error` and leaves the previous numbers in
    place: a rate limit should show yesterday's star count, not a blank card.
    """
    if not REPO.match(repo):
        return False

    row = db.one(connection, "SELECT etag, refreshed_at FROM github_stats WHERE repo = %s", (repo,))
    if row is None:
        ensure_row(connection, repo)
        row = {"etag": None, "refreshed_at": None}
    elif not force and row["refreshed_at"] is not None:
        age = _now() - row["refreshed_at"]
        if age < timedelta(hours=config.GITHUB_REFRESH_HOURS):
            return False

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            response = client.get(f"{API}/repos/{repo}", headers=_headers(row["etag"]))

            if response.status_code == 304:
                db.execute(
                    connection,
                    "UPDATE github_stats SET refreshed_at = %s, last_error = NULL WHERE repo = %s",
                    (_now(), repo),
                )
                return True

            if response.status_code != 200:
                db.execute(
                    connection,
                    "UPDATE github_stats SET last_error = %s WHERE repo = %s",
                    (f"repo {response.status_code}", repo),
                )
                return False

            payload = response.json()
            downloads, tag, released_at = _release_totals(client, repo)
            first_commit = _first_commit_at(client, repo)

        db.execute(
            connection,
            """UPDATE github_stats SET stars = %s, forks = %s, downloads = %s, language = %s,
                      license = %s, last_release_tag = %s, last_release_at = %s,
                      first_commit_at = COALESCE(%s, first_commit_at), etag = %s,
                      refreshed_at = %s, last_error = NULL
               WHERE repo = %s""",
            (
                payload.get("stargazers_count"),
                payload.get("forks_count"),
                downloads or None,
                payload.get("language"),
                (payload.get("license") or {}).get("spdx_id"),
                tag,
                released_at,
                first_commit,
                response.headers.get("etag"),
                _now(),
                repo,
            ),
        )
        return True

    except httpx.HTTPError as cause:
        db.execute(
            connection,
            "UPDATE github_stats SET last_error = %s WHERE repo = %s",
            (str(cause)[:255], repo),
        )
        return False


OWNED = re.compile(r"^[A-Za-z0-9._-]+$")


def _owned_listing(client: httpx.Client, owner: str):
    """Every repository an account owns, paged.

    `/users/{login}/repos` and not a branch on whether the login is a person or
    an organisation: the users endpoint answers for both, and returns for an
    organisation exactly what `/orgs/{login}/repos` returns. `type=owner` is the
    default for a person and is what drops the repositories they are only a
    member of.

    Answers None rather than a short list when a page fails, because the caller
    deletes whatever the listing did not mention and a truncated list would
    delete the rest of the account.
    """
    found = []
    page = 1

    while page <= 10:
        response = client.get(
            f"{API}/users/{owner}/repos",
            params={"per_page": 100, "page": page, "type": "owner", "sort": "full_name"},
            headers=_headers(),
        )
        if response.status_code != 200:
            return None
        payload = response.json()
        if not payload:
            break
        for repo in payload:
            found.append(
                {
                    "full_name": repo["full_name"],
                    "stars": int(repo.get("stargazers_count") or 0),
                    "is_fork": bool(repo.get("fork")),
                    "archived": bool(repo.get("archived")),
                }
            )
        if len(payload) < 100:
            break
        page += 1

    return found


def _store_listing(owner: str, listing: list) -> None:
    """The stars, committed before the downloads loop starts.

    Its own transaction on purpose: the listing is two requests and the loop after
    it is one per repository, so a rate limit reached halfway through would
    otherwise roll back star counts that were already known and correct.
    """
    with db.connect() as connection:
        if listing:
            db.many(
                connection,
                """INSERT INTO owned_repos
                     (full_name, owner, stars, is_fork, archived, refreshed_at, last_error)
                   VALUES (%s, %s, %s, %s, %s, %s, NULL)
                   ON DUPLICATE KEY UPDATE owner = VALUES(owner), stars = VALUES(stars),
                                           is_fork = VALUES(is_fork), archived = VALUES(archived),
                                           refreshed_at = VALUES(refreshed_at), last_error = NULL""",
                [
                    (repo["full_name"], owner, repo["stars"], repo["is_fork"], repo["archived"], _now())
                    for repo in listing
                ],
            )

        # Renamed, deleted, or taken private. Safe only because the listing came
        # back whole — `_owned_listing` answers None instead of a short list, so
        # reaching here means every page succeeded and an account that lists
        # nothing genuinely owns nothing.
        names = [repo["full_name"] for repo in listing]
        if names:
            placeholders = ", ".join(["%s"] * len(names))
            db.execute(
                connection,
                f"DELETE FROM owned_repos WHERE owner = %s AND full_name NOT IN ({placeholders})",
                (owner, *names),
            )
        else:
            db.execute(connection, "DELETE FROM owned_repos WHERE owner = %s", (owner,))


def refresh_owner(owner: str, force: bool = False) -> dict:
    """Sweep one account: every repository it owns, and what each one is worth.

    Two costs, deliberately separated. The listing carries every star count, so
    stars are two requests for an account of any size. Downloads are only ever
    reported per release asset, so they are one request per repository — which is
    the whole expense here, and the reason a fork is listed but never asked
    about.

    A failure leaves the previous numbers in place, the same bargain
    `refresh_repo` makes: the tab bar should show yesterday's total rather than a
    smaller one it cannot justify.
    """
    quiet = {"owner": owner, "repos": 0, "downloads": 0, "failed": 0, "skipped": True}
    if not OWNED.match(owner):
        return quiet

    if not force:
        with db.connect() as connection:
            seen = db.one(
                connection,
                "SELECT MAX(refreshed_at) AS at FROM owned_repos WHERE owner = %s",
                (owner,),
            )
        if seen is not None and seen["at"] is not None:
            if _now() - seen["at"] < timedelta(hours=config.GITHUB_REFRESH_HOURS):
                return quiet

    downloads_written = 0
    failed = 0

    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        try:
            listing = _owned_listing(client, owner)
        except httpx.HTTPError as cause:
            listing = None
            reason = str(cause)[:255]
        else:
            reason = "listing failed"

        if listing is None:
            with db.connect() as connection:
                db.execute(
                    connection,
                    "UPDATE owned_repos SET last_error = %s WHERE owner = %s",
                    (reason, owner),
                )
            return {"owner": owner, "repos": 0, "downloads": 0, "failed": 1, "skipped": False}

        _store_listing(owner, listing)

        for repo in listing:
            if repo["is_fork"]:
                continue
            try:
                total, _, _ = _release_totals(client, repo["full_name"])
            except httpx.HTTPError as cause:
                failed += 1
                with db.connect() as connection:
                    db.execute(
                        connection,
                        "UPDATE owned_repos SET last_error = %s WHERE full_name = %s",
                        (str(cause)[:255], repo["full_name"]),
                    )
                continue
            with db.connect() as connection:
                db.execute(
                    connection,
                    "UPDATE owned_repos SET downloads = %s WHERE full_name = %s",
                    (total, repo["full_name"]),
                )
            downloads_written += 1

    return {
        "owner": owner,
        "repos": len(listing),
        "downloads": downloads_written,
        "failed": failed,
        "skipped": False,
    }


def refresh_all(force: bool = False) -> dict:
    with db.connect() as connection:
        repos = [row["repo"] for row in db.rows(connection, "SELECT DISTINCT repo FROM projects WHERE repo <> ''")]
        for repo in repos:
            ensure_row(connection, repo)

    written = 0
    for repo in repos:
        with db.connect() as connection:
            if refresh_repo(connection, repo, force=force):
                written += 1

    # An account dropped from GITHUB_OWNERS stops being swept, which on its own
    # would leave its rows in the table counting toward the totals forever. The
    # configured list is the source of truth for what the numbers mean, so it is
    # also the source of truth for what the table may hold.
    with db.connect() as connection:
        if config.GITHUB_OWNERS:
            placeholders = ", ".join(["%s"] * len(config.GITHUB_OWNERS))
            db.execute(
                connection,
                f"DELETE FROM owned_repos WHERE owner NOT IN ({placeholders})",
                config.GITHUB_OWNERS,
            )
        else:
            db.execute(connection, "DELETE FROM owned_repos")

    # The project repositories first, then the accounts they belong to: a rate
    # limit reached halfway should cost the two numbers in the tab bar rather
    # than the language, the licence and the release line the cards are made of.
    owners = [refresh_owner(owner, force=force) for owner in config.GITHUB_OWNERS]

    return {"repos": len(repos), "written": written, "owners": owners}
