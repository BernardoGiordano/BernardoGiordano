"""The variant set survives the round trip out of the upload pipeline.

`media.store` writes one file per width and records the list; what these check is
the read side, which is what the renderers ask for. The parsing half needs no
database — a URL is a URL — and the lookup half writes a media row and removes it
again, because which variants exist is a per-row fact and deriving it from
`IMAGE_WIDTHS` is the thing this code exists not to do.
"""

import pytest

from app import config, db, media

# The base path is the first 32 characters of the digest, so two rows that
# differ only in the tail would share one base and defeat the point.
DIGEST = "a" * 64
BASE = f"2026/08/{DIGEST[:32]}"
OTHER_DIGEST = "b" * 64
OTHER_BASE = f"2026/08/{OTHER_DIGEST[:32]}"


def url_for(base, width):
    return f"{config.MEDIA_URL}/{base}-{width}.webp"


def _insert(connection, digest, base, widths):
    db.execute(
        connection,
        """INSERT INTO media (digest, purpose, base_path, width, height, widths, bytes, original_name)
           VALUES (%s, 'pytest', %s, %s, %s, %s, %s, 'pytest.webp')""",
        (digest, base, widths[-1], widths[-1], db.dumps(widths), 1234),
    )


@pytest.fixture
def stored():
    """One picture with three variants and one with a single variant."""
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM media WHERE purpose = 'pytest'")
        _insert(connection, DIGEST, BASE, [240, 480, 960])
        _insert(connection, OTHER_DIGEST, OTHER_BASE, [480])
    yield
    with db.connect() as connection:
        db.execute(connection, "DELETE FROM media WHERE purpose = 'pytest'")


def test_base_is_read_back_out_of_a_variant_url():
    assert media.base_of(url_for(BASE, 960)) == BASE


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/2026/08/abc-480.webp",
        f"{config.MEDIA_URL}/2026/08/abc.webp",
        f"{config.MEDIA_URL}/2026/08/abc-wide.webp",
        f"{config.MEDIA_URL}/-480.webp",
        "",
        None,
    ],
)
def test_anything_this_site_did_not_write_has_no_base(url):
    assert media.base_of(url) is None


def test_srcset_names_every_stored_variant(stored):
    with db.connect() as connection:
        value = media.srcset(connection, url_for(BASE, 960))

    assert value == ", ".join(
        (
            f"{url_for(BASE, 240)} 240w",
            f"{url_for(BASE, 480)} 480w",
            f"{url_for(BASE, 960)} 960w",
        )
    )


def test_a_single_variant_gets_no_srcset(stored):
    """A one-candidate srcset repeats `src` and buys the browser nothing."""
    with db.connect() as connection:
        assert media.srcset(connection, url_for(OTHER_BASE, 480)) == ""


def test_a_foreign_cover_gets_no_srcset(stored):
    with db.connect() as connection:
        assert media.srcset(connection, "https://example.com/cover.jpg") == ""


def test_a_list_of_urls_costs_one_lookup(stored):
    """The list endpoints hand every cover over at once; unknown ones are absent
    from the result rather than present and empty."""
    urls = [url_for(BASE, 960), url_for(OTHER_BASE, 480), "https://example.com/cover.jpg", ""]
    with db.connect() as connection:
        found = media.srcsets(connection, urls)

    assert list(found) == [url_for(BASE, 960)]


def test_the_widths_a_row_records_win_over_the_configured_ladder(stored):
    """`IMAGE_WIDTHS` can gain a step tomorrow; the files written yesterday do
    not, and a srcset that named one would send the browser to a 404."""
    with db.connect() as connection:
        value = media.srcset(connection, url_for(BASE, 960))

    assert f"{max(config.IMAGE_WIDTHS)}w" not in value
