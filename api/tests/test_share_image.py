"""The social card names an image a scraper can fetch and decode.

Open Graph wants an absolute URL, and some link-preview scrapers cannot read
WebP, which is the only format `media.store` writes. So the shell names a JPEG
twin of the same variant on the site's own origin, written beside the WebP the
first time a page needs it.

`describe` is stubbed, because what it reads is not the subject here. The media
tree is a temporary directory.
"""

import re

import pytest
from PIL import Image

from app import config, media, seo

ORIGIN = "https://santella.dev"
NAME = f"{'c' * 32}-960"
STEM = f"2026/10/{NAME}"
SHELL = '<html><head><title>x</title><meta name="description" content="" /></head><body></body></html>'


@pytest.fixture
def media_root(tmp_path, monkeypatch):
    root = tmp_path.resolve()
    (root / "2026" / "10").mkdir(parents=True)
    monkeypatch.setattr(config, "MEDIA_ROOT", root)
    monkeypatch.setattr(config, "SITE_ORIGIN", ORIGIN)
    return root


def _webp(root, mode, colour):
    Image.new(mode, (960, 540), colour).save(root / f"{STEM}.webp", "WEBP")
    return f"{config.MEDIA_URL}/{STEM}.webp"


def _og_image(monkeypatch, image):
    monkeypatch.setattr(seo, "describe", lambda path: ("title", "description", image))
    document = seo.render_shell(SHELL, "/blog/a-post")
    return re.search(r'property="og:image" content="([^"]*)"', document).group(1)


def test_a_stored_cover_is_shared_as_an_absolute_jpeg(media_root, monkeypatch):
    image = _og_image(monkeypatch, _webp(media_root, "RGB", (200, 40, 40)))

    assert image == f"{ORIGIN}{config.MEDIA_URL}/{STEM}.jpg"
    with Image.open(media_root / f"{STEM}.jpg") as written:
        assert written.format == "JPEG"
        assert written.size == (960, 540)

    # The private name it was encoded under is gone.
    assert sorted(path.name for path in (media_root / "2026" / "10").iterdir()) == [
        f"{NAME}.jpg",
        f"{NAME}.webp",
    ]


def test_transparency_is_kept_as_png(media_root):
    url = _webp(media_root, "RGBA", (200, 40, 40, 0))

    assert media.shareable(url) == f"{config.MEDIA_URL}/{STEM}.png"
    with Image.open(media_root / f"{STEM}.png") as written:
        assert written.mode == "RGBA"


def test_the_twin_is_written_once(media_root):
    url = _webp(media_root, "RGB", (200, 40, 40))
    media.shareable(url)
    written = (media_root / f"{STEM}.jpg").stat().st_mtime_ns

    assert media.shareable(url) == f"{config.MEDIA_URL}/{STEM}.jpg"
    assert (media_root / f"{STEM}.jpg").stat().st_mtime_ns == written


def test_a_foreign_cover_is_left_alone(media_root, monkeypatch):
    assert _og_image(monkeypatch, "https://example.com/cover.jpg") == "https://example.com/cover.jpg"


def test_a_missing_file_still_gets_an_absolute_url(media_root, monkeypatch):
    """No twin can be written, and a WebP card is better than no card."""
    url = f"{config.MEDIA_URL}/{STEM}.webp"

    assert _og_image(monkeypatch, url) == f"{ORIGIN}{url}"


def test_a_path_outside_the_media_tree_is_not_read(media_root):
    url = f"{config.MEDIA_URL}/../../etc/{NAME}.webp"

    assert media.shareable(url) == url
