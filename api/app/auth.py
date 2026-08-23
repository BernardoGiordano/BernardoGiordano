import hashlib
import ipaddress
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException, Request, Response

from . import config, db

hasher = PasswordHasher()

# Reads are public; only writes need the session, so the CSRF rule is by method
# rather than by route.
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(stored: str, password: str) -> bool:
    try:
        return hasher.verify(stored, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _client_ip(request: Request) -> bytes:
    """Packed, so IPv4 and IPv6 share one column and neither is stored as text
    somebody has to normalise before comparing."""
    host = request.client.host if request.client else "0.0.0.0"
    try:
        return ipaddress.ip_address(host).packed
    except ValueError:
        return b"\x00\x00\x00\x00"


def throttled(connection, request: Request) -> bool:
    since = _now() - timedelta(minutes=config.LOGIN_WINDOW_MINUTES)
    row = db.one(
        connection,
        "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = %s AND ok = 0 AND created_at > %s",
        (_client_ip(request), since),
    )
    return (row["n"] if row else 0) >= config.LOGIN_MAX_ATTEMPTS


def record_attempt(connection, request: Request, username: str, ok: bool) -> None:
    db.execute(
        connection,
        "INSERT INTO login_attempts (ip, username, ok) VALUES (%s, %s, %s)",
        (_client_ip(request), username[:64], 1 if ok else 0),
    )


def open_session(connection, response: Response, request: Request, user) -> dict:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)[:43]
    expires = _now() + timedelta(hours=config.SESSION_TTL_HOURS)

    db.execute(
        connection,
        """INSERT INTO sessions (id, user_id, csrf_token, expires_at, user_agent)
           VALUES (%s, %s, %s, %s, %s)""",
        (_digest(token), user["id"], csrf, expires, (request.headers.get("user-agent") or "")[:255]),
    )

    response.set_cookie(
        config.COOKIE_NAME,
        token,
        max_age=config.SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="strict",
        path="/",
    )
    return payload_for(user, csrf)


def close_session(connection, request: Request, response: Response) -> None:
    token = request.cookies.get(config.COOKIE_NAME)
    if token:
        db.execute(connection, "DELETE FROM sessions WHERE id = %s", (_digest(token),))
    response.delete_cookie(config.COOKIE_NAME, path="/", httponly=True, secure=config.COOKIE_SECURE, samesite="strict")


def current(connection, request: Request):
    """The session this request belongs to, or None. Expiry is decided here so one
    place owns what 'over' means."""
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        return None

    row = db.one(
        connection,
        """SELECT s.id, s.csrf_token, s.expires_at, u.id AS user_id, u.username, u.display_name, u.scopes
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = %s""",
        (_digest(token),),
    )
    if row is None:
        return None
    if row["expires_at"] <= _now():
        db.execute(connection, "DELETE FROM sessions WHERE id = %s", (row["id"],))
        return None

    db.execute(connection, "UPDATE sessions SET last_seen_at = %s WHERE id = %s", (_now(), row["id"]))
    return row


def payload_for(user, csrf: str | None) -> dict:
    """The shape srl's BffCookieTokenStore admits: `expiresAt` is epoch
    milliseconds, and `csrfToken` is omitted when there is none to send — the
    store keeps whatever it already holds in that case."""
    expires_at = _now() + timedelta(minutes=config.SESSION_WINDOW_MINUTES)
    body = {
        "sub": user["username"],
        "name": user["display_name"],
        "scopes": [scope for scope in str(user["scopes"]).split() if scope],
        "expiresAt": int(expires_at.replace(tzinfo=timezone.utc).timestamp() * 1000),
    }
    if csrf is not None:
        body["csrfToken"] = csrf
    return body


def require_writer(request: Request):
    """A dependency for every mutating route: a session, and a CSRF header that
    matches the one this session was issued. Returns the session row."""
    with db.connect() as connection:
        session = current(connection, request)
        if session is None:
            raise HTTPException(status_code=401, detail="no_session")

        if request.method in MUTATING:
            header = request.headers.get("x-csrf-token", "")
            if not secrets.compare_digest(header, session["csrf_token"]):
                raise HTTPException(status_code=403, detail="csrf_mismatch")

        if "site:write" not in str(session["scopes"]).split():
            raise HTTPException(status_code=403, detail="missing_scope")

        return session


def purge_expired(connection) -> int:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM sessions WHERE expires_at <= %s", (_now(),))
        gone = cursor.rowcount
        cursor.execute(
            "DELETE FROM login_attempts WHERE created_at < %s",
            (_now() - timedelta(days=7),),
        )
    return gone
