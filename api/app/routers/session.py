from fastapi import APIRouter, HTTPException, Request, Response

from .. import auth, db
from ..models import Credentials

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(credentials: Credentials, request: Request, response: Response):
    with db.connect() as connection:
        if auth.throttled(connection, request):
            raise HTTPException(status_code=429, detail="too_many_attempts")

        user = db.one(
            connection,
            "SELECT id, username, display_name, password_hash, scopes FROM users WHERE username = %s",
            (credentials.username,),
        )

        # Verified even when the username is unknown, against a hash that cannot
        # match: a fast "no such user" and a slow "wrong password" are a username
        # oracle. The verify runs before the `and`, so an unknown username still
        # pays for it.
        stored = user["password_hash"] if user else auth.hash_password("_")
        accepted = auth.verify_password(stored, credentials.password) and user is not None

        if accepted:
            auth.record_attempt(connection, request, credentials.username, ok=True)
            auth.purge_expired(connection)
            return auth.open_session(connection, response, request, user)

    # Outside the block above, and so outside its transaction: the 401 below
    # propagates through `db.connect`, which rolls back, and a failure recorded on
    # that connection would be rolled back with it. Nothing would ever land in
    # login_attempts with ok = 0 — which is the only thing `throttled` counts, so
    # the rate limit would never fire. This is its own transaction, committed
    # before the exception is raised.
    with db.connect() as connection:
        auth.record_attempt(connection, request, credentials.username, ok=False)
    raise HTTPException(status_code=401, detail="rejected")


@router.delete("/login")
def logout(request: Request, response: Response):
    with db.connect() as connection:
        auth.close_session(connection, request, response)
    return Response(status_code=204)


@router.get("/session")
def session(request: Request):
    with db.connect() as connection:
        current = auth.current(connection, request)
        if current is None:
            raise HTTPException(status_code=401, detail="no_session")
        # The session's own CSRF token, echoed rather than reissued: it is a
        # constant for the life of the session, so handing back the same string
        # cannot disarm a write already in flight. It has to be here — a page
        # reloaded on an existing cookie has the session and no token, and every
        # write from it would be a 403 until the user logged in again.
        return auth.payload_for(
            {"username": current["username"], "display_name": current["display_name"], "scopes": current["scopes"]},
            current["csrf_token"],
        )
