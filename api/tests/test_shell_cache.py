"""The shell document, rendered once and kept.

Every navigation used to re-read index.html from disk and run a profile query so
render_shell could rewrite the title and append five meta tags — at the head of a
chain the whole page waits behind. What matters now is that the second request
for a URL does neither, that a write the document quotes still shows up, and that
answering arbitrary URLs cannot grow the cache without bound.

`describe` is the thing being counted, so it is stubbed: this is about how often
it is called, not about what it reads.
"""

import pytest

from app import seo


@pytest.fixture
def index(tmp_path):
    document = tmp_path / "index.html"
    document.write_text(
        '<html><head><title>santella.dev</title>'
        '<meta name="description" content="" /></head><body></body></html>',
        "utf-8",
    )
    return document


@pytest.fixture
def described(monkeypatch):
    """`describe`, stubbed, with the paths it was asked about."""
    seen = []

    def describe(path):
        seen.append(path)
        return f"title {path}", f"description {path}", None

    monkeypatch.setattr(seo, "describe", describe)
    seo.forget_shells()
    yield seen
    seo.forget_shells()


def test_second_request_for_a_path_renders_nothing(index, described):
    first = seo.shell(index, "/projects")
    second = seo.shell(index, "/projects")

    assert first == second
    assert described == ["/projects"]
    assert "title /projects" in first


def test_each_url_gets_its_own_document(index, described):
    projects = seo.shell(index, "/projects")
    art = seo.shell(index, "/art")

    assert projects != art
    assert described == ["/projects", "/art"]
    assert seo.shell(index, "/art") == art
    assert described == ["/projects", "/art"]


def test_a_write_is_visible_on_the_next_request(index, described):
    seo.shell(index, "/blog/a-post")
    seo.forget_shells()
    seo.shell(index, "/blog/a-post")

    assert described == ["/blog/a-post", "/blog/a-post"]


def test_an_edited_document_is_reread(index, described):
    before = seo.shell(index, "/cv")
    index.write_text(
        '<html><head><title>santella.dev</title>'
        '<meta name="description" content="" /><meta name="build" content="2" /></head>'
        "<body></body></html>",
        "utf-8",
    )
    after = seo.shell(index, "/cv")

    assert 'name="build"' not in before
    assert 'name="build"' in after


def test_invented_urls_cannot_grow_it(index, described):
    for number in range(seo._SHELL_LIMIT + 50):
        seo.shell(index, f"/nothing-here-{number}")

    assert len(seo._shells) == seo._SHELL_LIMIT
    # The oldest went first, and the most recent is still there.
    assert "/nothing-here-0" not in seo._shells
    assert f"/nothing-here-{seo._SHELL_LIMIT + 49}" in seo._shells
