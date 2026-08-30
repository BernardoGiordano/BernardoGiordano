import json
from contextlib import contextmanager

import pymysql
from dbutils.pooled_db import PooledDB
from pymysql.cursors import DictCursor

from . import config

_pool = None


def pool():
    """Built on first use, not at import: importing this module must not require a
    reachable database, or the migration tools and every unit test would need one
    before they could read a single function."""
    global _pool
    if _pool is None:
        _pool = PooledDB(
            creator=pymysql,
            maxconnections=8,
            # Two connections opened when the pool is built rather than none. The
            # pool used to start empty, so the first request after a restart paid
            # a TCP connect and a MySQL handshake before its first statement, and
            # `main.lifespan` builds the pool at startup so those two are already
            # open when the first visitor arrives. Two and not eight because idle
            # connections cost the server something and the pool grows to
            # maxconnections on demand anyway.
            mincached=2,
            blocking=True,
            ping=1,
            autocommit=False,
            charset="utf8mb4",
            cursorclass=DictCursor,
            **config.DB,
        )
    return _pool


@contextmanager
def connect():
    """One transaction per caller. Endpoints are sync `def`, so FastAPI runs them
    in a worker thread and a blocking driver costs the event loop nothing."""
    connection = pool().connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def rows(connection, sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()


def one(connection, sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


def execute(connection, sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.lastrowid


def many(connection, sql, seq):
    with connection.cursor() as cursor:
        cursor.executemany(sql, seq)
        return cursor.rowcount


def as_list(value):
    """A JSON column, whichever way the driver hands it back: PyMySQL returns a
    string on some server versions and a decoded value on others, and a reader
    that assumed one of them breaks on the other."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return []
        return decoded if isinstance(decoded, list) else []
    return []


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
