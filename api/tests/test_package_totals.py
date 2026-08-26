"""`packages.site_totals`, which is the one place the site decides what a
download is.

Three things are worth a test and none of them can be answered by reading the
function. That a project declaring a package has its GitHub release count
*replaced* rather than added to — the bug this shape exists to prevent is
counting a library's work twice, once as installs and once as release assets.
That two projects naming the same package add it up once. And that a name which
is not a package name never reaches a request path.

Against a real MySQL, because all three are decided by SQL: two `EXISTS`
subqueries and a primary key.
"""

import pytest

from app import db, packages


OWNER = "pytest-packages"
REPO = f"{OWNER}/library"
PLAIN = f"{OWNER}/plain"
PACKAGE = ("npm", "@pytest-packages/library")


def _clear():
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM projects WHERE name LIKE %s", ("pytest-packages%",))
        db.execute(connection, "DELETE FROM owned_repos WHERE owner = %s", (OWNER,))
        db.execute(connection, "DELETE FROM package_stats WHERE name LIKE %s", ("@pytest-packages/%",))


def _project(connection, name, repo, registry="", package=""):
    return db.execute(
        connection,
        """INSERT INTO projects
             (name, description, url, repo, kind, role, status, open_source, featured,
              platforms, tech, package_registry, package_name, position)
           VALUES (%s, '', '', %s, '', 'author', 'active', 1, 0, '[]', '[]', %s, %s, 0)""",
        (name, repo, registry, package),
    )


def _repo(connection, full_name, stars, downloads):
    db.execute(
        connection,
        """INSERT INTO owned_repos (full_name, owner, stars, downloads, is_fork, archived, refreshed_at)
           VALUES (%s, %s, %s, %s, 0, 0, NOW())""",
        (full_name, OWNER, stars, downloads),
    )


def _package(connection, registry, name, downloads):
    db.execute(
        connection,
        """INSERT INTO package_stats (registry, name, downloads, refreshed_at)
           VALUES (%s, %s, %s, NOW())""",
        (registry, name, downloads),
    )


@pytest.fixture
def scratch():
    """Two owned repositories and nothing claiming them yet. Each test adds the
    projects it needs on top."""
    _clear()
    with db.connect() as connection:
        _repo(connection, REPO, stars=10, downloads=1000)
        _repo(connection, PLAIN, stars=5, downloads=200)
    yield
    _clear()


def _totals():
    with db.connect() as connection:
        return packages.site_totals(connection)


def test_github_downloads_count_when_no_package_is_declared(scratch):
    with db.connect() as connection:
        _project(connection, "pytest-packages a", REPO)
        _project(connection, "pytest-packages b", PLAIN)

    assert _totals()["downloads"] >= 1200


def test_a_declared_package_replaces_the_repository_it_names(scratch):
    """1000 release downloads and 40 installs is 40 plus whatever else the
    account has — not 1040. The repository is left out of the GitHub sum
    entirely, because its releases and its installs are the same work."""
    before = _totals()["downloads"]
    with db.connect() as connection:
        _project(connection, "pytest-packages a", REPO, *PACKAGE)
        _package(connection, *PACKAGE, downloads=40)

    assert _totals()["downloads"] == before - 1000 + 40


def test_two_projects_naming_one_package_add_it_once(scratch):
    before = _totals()["downloads"]
    with db.connect() as connection:
        _project(connection, "pytest-packages a", REPO, *PACKAGE)
        _project(connection, "pytest-packages b", "", *PACKAGE)
        _package(connection, *PACKAGE, downloads=40)

    assert _totals()["downloads"] == before - 1000 + 40


def test_a_package_that_never_polled_subtracts_nothing_it_cannot_replace(scratch):
    """`downloads` is NULL until a poll succeeds, and SUM skips NULL. The
    repository is still displaced, so the figure drops by what GitHub reported —
    the alternative is a total that silently keeps counting release assets for a
    project whose card has stopped showing them."""
    before = _totals()["downloads"]
    with db.connect() as connection:
        _project(connection, "pytest-packages a", REPO, *PACKAGE)
        packages.ensure_row(connection, *PACKAGE)

    assert _totals()["downloads"] == before - 1000


@pytest.mark.parametrize(
    "registry, name",
    [
        ("npm", "@srljs/core"),
        ("npm", "express"),
        ("npm", "some.package_name-2"),
        ("dockerhub", "library/nginx"),
        ("dockerhub", "bernardogiordano/app"),
    ],
)
def test_names_a_registry_would_recognise(registry, name):
    assert packages.valid(registry, name)


@pytest.mark.parametrize(
    "registry, name",
    [
        # A path that would climb out of the endpoint it is interpolated into.
        ("npm", "../../etc/passwd"),
        ("dockerhub", "../../v2/repositories/library/nginx"),
        # A query string, which would reach the registry as arguments.
        ("npm", "express?a=1"),
        # Docker Hub's API has no short form: `nginx` is `library/nginx`.
        ("dockerhub", "nginx"),
        # npm names are lowercase, and an uppercase one is a different package
        # that no longer exists.
        ("npm", "Express"),
        ("npm", ""),
        ("pypi", "requests"),
    ],
)
def test_names_no_registry_should_be_asked_for(registry, name):
    assert not packages.valid(registry, name)
