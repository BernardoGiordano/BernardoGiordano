"""Operational commands. One file, because each of these runs a handful of times
in the life of the site and a CLI framework would be more code than the commands.

  init-db                      apply schema.sql
  set-password <user> <name>   create or repoint the single account (prompts)
  refresh-stats [--force]      poll GitHub and the package registries now
  purge-sessions               drop expired sessions, old login attempts and
                               spent visit marks
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import auth, db, packages  # noqa: E402
from app.routers import visits  # noqa: E402


# Columns added to a table that already exists somewhere. `CREATE TABLE IF NOT
# EXISTS` is a no-op against a live database, and MySQL has no `ADD COLUMN IF
# NOT EXISTS`, so an additive change is declared in schema.sql for a fresh
# install and listed here for the databases that predate it. `init-db` stays the
# one command, and running it twice is still nothing.
ADDED_COLUMNS = (
    ("profile", "now_text", "VARCHAR(255) NOT NULL DEFAULT '' AFTER `current`"),
    ("profile", "available", "VARCHAR(128) NOT NULL DEFAULT '' AFTER now_text"),
    ("projects", "package_registry", "VARCHAR(16) NOT NULL DEFAULT '' AFTER downloads_override"),
    ("projects", "package_name", "VARCHAR(160) NOT NULL DEFAULT '' AFTER package_registry"),
)


# The same, for indexes: `CREATE INDEX` has no `IF NOT EXISTS` either, and a
# second run would fail on the name rather than pass.
ADDED_INDEXES = (
    ("media", "idx_media_base", "(base_path)"),
)


def _apply_added_columns(connection):
    for table, column, definition in ADDED_COLUMNS:
        present = db.one(
            connection,
            """SELECT 1 AS found FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = %s AND column_name = %s""",
            (table, column),
        )
        if present is None:
            db.execute(connection, f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            print(f"{table}.{column} added")


def _apply_added_indexes(connection):
    for table, index, columns in ADDED_INDEXES:
        present = db.one(
            connection,
            """SELECT 1 AS found FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = %s AND index_name = %s""",
            (table, index),
        )
        if present is None:
            db.execute(connection, f"CREATE INDEX {index} ON {table} {columns}")
            print(f"{table}.{index} added")


def init_db():
    raw = (Path(__file__).resolve().parents[1] / "schema.sql").read_text("utf-8")
    # Comments come out before the split: a `--` line containing a semicolon
    # would otherwise cut a statement in half.
    sql = "\n".join(line for line in raw.splitlines() if not line.lstrip().startswith("--"))

    with db.connect() as connection:
        with connection.cursor() as cursor:
            for statement in [s.strip() for s in sql.split(";") if s.strip()]:
                cursor.execute(statement)
        _apply_added_columns(connection)
        _apply_added_indexes(connection)
    print("schema applied")


def set_password(username: str, display_name: str):
    password = getpass.getpass("password: ")
    if len(password) < 12:
        raise SystemExit("refusing a password shorter than 12 characters")
    if password != getpass.getpass("again: "):
        raise SystemExit("they differ")

    with db.connect() as connection:
        db.execute(
            connection,
            """INSERT INTO users (username, display_name, password_hash) VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash)""",
            (username, display_name, auth.hash_password(password)),
        )
        db.execute(connection, "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = %s)", (username,))
    print(f"{username} set, existing sessions revoked")


def refresh_stats(force: bool):
    print(packages.refresh_everything(force=force))


def purge_sessions():
    with db.connect() as connection:
        print(f"{auth.purge_expired(connection)} sessions dropped")
        print(f"{visits.purge(connection)} visit marks dropped")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "init-db":
        init_db()
    elif command == "set-password" and len(sys.argv) >= 4:
        set_password(sys.argv[2], " ".join(sys.argv[3:]))
    elif command == "refresh-stats":
        refresh_stats("--force" in sys.argv)
    elif command == "purge-sessions":
        purge_sessions()
    else:
        print(__doc__)
        raise SystemExit(2)
