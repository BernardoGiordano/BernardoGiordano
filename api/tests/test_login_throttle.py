"""The per-IP brute-force limit on POST /auth/login.

The limit counts rows in login_attempts with ok = 0. Those rows are written on the
way to a 401, and a 401 raised inside `db.connect` rolls the transaction back — so
for a while the count was of rows that could never exist and the limit never
fired. Every test here is about the row surviving the response that created it.
"""

from datetime import timedelta

import pytest

from app import auth, config, db
from conftest import TEST_IP_PACKED, TEST_USERNAME


def _post(client, username, password):
    return client.post("/auth/login", json={"username": username, "password": password})


def test_failed_login_is_persisted(client, account, attempts):
    """A rejected password leaves an ok = 0 row behind. If the 401's rollback ever
    takes the INSERT with it again, this is the test that goes red first."""
    response = _post(client, account["username"], "not the password")

    assert response.status_code == 401
    assert attempts(ok=False) == 1


def test_failed_login_for_unknown_user_is_persisted(client, clean_attempts, attempts):
    """An unknown username is the shape a brute-force sweep actually has, and it
    takes the same path: no user row, so nothing to hang the attempt off, and it
    still has to be counted."""
    response = _post(client, TEST_USERNAME, "not the password")

    assert response.status_code == 401
    assert attempts(ok=False) == 1


def test_throttle_fires_on_the_attempt_after_the_limit(client, account, attempts):
    """N failures are allowed; the next request is refused before the password is
    looked at. N is config.LOGIN_MAX_ATTEMPTS, read here rather than hard-coded so
    the test follows the setting."""
    limit = config.LOGIN_MAX_ATTEMPTS

    for n in range(limit):
        response = _post(client, account["username"], "not the password")
        assert response.status_code == 401, f"attempt {n + 1} of {limit} should be a plain rejection"

    assert attempts(ok=False) == limit

    refused = _post(client, account["username"], "not the password")
    assert refused.status_code == 429
    assert refused.json()["detail"] == "too_many_attempts"


def test_throttle_refuses_the_correct_password_too(client, account, attempts):
    """The limit is on the address, not on the guess: once it is reached the right
    password is refused as well. Otherwise an attacker who found the password on
    the last allowed attempt would simply carry on."""
    for _ in range(config.LOGIN_MAX_ATTEMPTS):
        assert _post(client, account["username"], "not the password").status_code == 401

    refused = _post(client, account["username"], account["password"])
    assert refused.status_code == 429


def test_successful_login_still_works_and_is_recorded(client, account, attempts):
    response = _post(client, account["username"], account["password"])

    assert response.status_code == 200
    assert response.json()["sub"] == account["username"]
    assert config.COOKIE_NAME in response.cookies
    assert attempts(ok=True) == 1
    assert attempts(ok=False) == 0


def test_successes_do_not_count_towards_the_limit(client, account, attempts):
    """Logging in and out repeatedly must not lock the account's own address out."""
    for _ in range(config.LOGIN_MAX_ATTEMPTS + 1):
        assert _post(client, account["username"], account["password"]).status_code == 200

    assert attempts(ok=False) == 0


def test_attempts_outside_the_window_do_not_count(client, account, attempts, attempt_rows, backdate):
    """The count is over LOGIN_WINDOW_MINUTES. Rows older than that are still in the
    table until the purge runs, and must not hold the limit down in the meantime."""
    for _ in range(config.LOGIN_MAX_ATTEMPTS):
        assert _post(client, account["username"], "not the password").status_code == 401

    older_than_the_window = (config.LOGIN_WINDOW_MINUTES + 1) / (60 * 24)
    for row in attempt_rows():
        backdate(row["id"], older_than_the_window)

    assert attempts(ok=False) == config.LOGIN_MAX_ATTEMPTS
    assert _post(client, account["username"], account["password"]).status_code == 200


def test_unknown_username_and_wrong_password_take_a_comparable_time(client, account):
    """Not a timing measurement — a structural check that the dummy verify is still
    reached. `verify_password` is called before the `user is None` test, so an
    unknown username costs an argon2 verify exactly as a wrong password does. A
    refactor that short-circuits on the missing row reintroduces a username
    oracle, and it would show up here as one call instead of two."""
    calls = []
    real = auth.verify_password

    def counting(stored, password):
        calls.append(stored)
        return real(stored, password)

    auth.verify_password = counting
    try:
        assert _post(client, "no-such-user-at-all", "whatever").status_code == 401
        assert _post(client, account["username"], "not the password").status_code == 401
    finally:
        auth.verify_password = real

    assert len(calls) == 2, "the unknown username skipped the verify"
    assert calls[0] != calls[1], "the unknown username should verify against the dummy hash"
    assert calls[0].startswith("$argon2")


def test_purge_prunes_old_login_attempts(clean_attempts, attempt_rows, backdate):
    """`manage.py purge-sessions` calls auth.purge_expired, which drops attempts
    older than seven days. Nothing could accumulate before the fix, so this is the
    first time the branch has had rows to act on."""
    with db.connect() as connection:
        for username in ("stale", "fresh"):
            db.execute(
                connection,
                "INSERT INTO login_attempts (ip, username, ok) VALUES (%s, %s, 0)",
                (TEST_IP_PACKED, username),
            )

    rows = {row["username"]: row["id"] for row in attempt_rows()}
    backdate(rows["stale"], 8)
    backdate(rows["fresh"], 6)

    with db.connect() as connection:
        auth.purge_expired(connection)

    assert [row["username"] for row in attempt_rows()] == ["fresh"]


def test_purge_sessions_command_prunes_attempts(clean_attempts, attempt_rows, backdate, capsys):
    """The command itself, not just the function it calls: purge_sessions opens its
    own connection, and the delete has to be committed when it returns."""
    import tools.manage as manage

    with db.connect() as connection:
        db.execute(
            connection,
            "INSERT INTO login_attempts (ip, username, ok) VALUES (%s, %s, 0)",
            (TEST_IP_PACKED, "stale"),
        )
    backdate(attempt_rows()[0]["id"], 8)

    manage.purge_sessions()

    assert list(attempt_rows()) == []
    assert "sessions dropped" in capsys.readouterr().out
