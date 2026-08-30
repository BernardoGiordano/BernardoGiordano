import hashlib
import io
from datetime import datetime, timezone

from PIL import Image, ImageOps, UnidentifiedImageError

from . import config, db

# Pillow's own decompression-bomb guard, kept and lowered: nothing this site
# publishes needs 90 megapixels, and the default limit is a DoS budget rather
# than a policy.
Image.MAX_IMAGE_PIXELS = 64_000_000

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF", "AVIF", "HEIF"}


class RejectedImage(Exception):
    pass


def store(raw: bytes, purpose: str, original_name: str) -> dict:
    """Re-encode to WebP at up to three widths.

    Re-encoding is what strips the metadata: nothing from the source `info` is
    passed to `save`, so EXIF — GPS coordinates included — XMP and the ICC
    profile do not survive. Orientation is applied to the pixels first, because
    dropping the EXIF that carried it would otherwise rotate the image.
    """
    if len(raw) > config.UPLOAD_MAX_BYTES:
        raise RejectedImage(f"larger than {config.UPLOAD_MAX_BYTES} bytes")

    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as cause:
        raise RejectedImage("not a readable image") from cause

    if probe.format not in ALLOWED_FORMATS:
        raise RejectedImage(f"format {probe.format} is not accepted")

    # verify() leaves the file object unusable, so the real decode is a second open.
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image) or image

    has_alpha = image.mode in {"RGBA", "LA", "PA"} or (image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if has_alpha else "RGB")

    digest = hashlib.sha256(raw).hexdigest()
    now = datetime.now(timezone.utc)
    directory = config.MEDIA_ROOT / f"{now:%Y}" / f"{now:%m}"
    directory.mkdir(parents=True, exist_ok=True)

    base = f"{now:%Y}/{now:%m}/{digest[:32]}"
    widths = []
    written = 0

    for width in config.IMAGE_WIDTHS:
        if width > image.width and widths:
            break
        target = image if width >= image.width else _resized(image, width)
        path = config.MEDIA_ROOT / f"{base}-{target.width}.webp"
        target.save(path, "WEBP", quality=config.IMAGE_QUALITY, method=5)
        written += path.stat().st_size
        widths.append(target.width)
        if target.width == image.width:
            break

    with db.connect() as connection:
        existing = db.one(connection, "SELECT id FROM media WHERE digest = %s", (digest,))
        if existing is None:
            media_id = db.execute(
                connection,
                """INSERT INTO media (digest, purpose, base_path, width, height, widths, bytes, original_name)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (digest, purpose[:32], base, image.width, image.height, db.dumps(widths), written, original_name[:255]),
            )
        else:
            media_id = existing["id"]

    return {
        "id": media_id,
        "url": variant_url(base, widths[-1]),
        "srcset": srcset_of(base, widths),
        "width": image.width,
        "height": image.height,
        "widths": widths,
    }


def _resized(image: Image.Image, width: int) -> Image.Image:
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.LANCZOS)


# ── reading a stored variant set back ────────────────────────────────────────
#
# `store` writes one file per width and records the list in `media.widths`. What
# a renderer needs is that same list as an `srcset`, and the column is the only
# honest source for it: the loop stops at the source image's own width, so which
# variants exist is a property of the upload rather than of `IMAGE_WIDTHS`, and
# a set derived from the config would name files that were never written the day
# that tuple changes.


def variant_url(base: str, width: int) -> str:
    return f"{config.MEDIA_URL}/{base}-{width}.webp"


def srcset_of(base: str, widths) -> str:
    return ", ".join(f"{variant_url(base, w)} {w}w" for w in widths)


def base_of(url: str) -> str | None:
    """The `base` behind one variant URL, or None for anything this site did not
    write — a cover pasted in from elsewhere is a URL and nothing more."""
    prefix = f"{config.MEDIA_URL}/"
    if not isinstance(url, str) or not url.startswith(prefix) or not url.endswith(".webp"):
        return None
    base, separator, width = url[len(prefix) : -len(".webp")].rpartition("-")
    if not separator or not base or not width.isdigit():
        return None
    return base


def srcsets(connection, urls) -> dict:
    """`{url: srcset}` for those of `urls` that name stored media, in one query.

    A url with a single variant is left out rather than given a one-candidate
    `srcset`: the attribute would then repeat what `src` already says, and the
    renderer's `*if` on it is what keeps that out of the markup.
    """
    by_base: dict[str, list[str]] = {}
    for url in urls:
        base = base_of(url)
        if base is not None:
            by_base.setdefault(base, []).append(url)
    if not by_base:
        return {}

    placeholders = ", ".join(["%s"] * len(by_base))
    rows = db.rows(
        connection,
        f"SELECT base_path, widths FROM media WHERE base_path IN ({placeholders})",
        tuple(by_base),
    )

    found = {}
    for row in rows:
        widths = [int(width) for width in db.as_list(row["widths"])]
        if len(widths) < 2:
            continue
        value = srcset_of(row["base_path"], widths)
        for url in by_base[row["base_path"]]:
            found[url] = value
    return found


def srcset(connection, url: str) -> str:
    return srcsets(connection, [url]).get(url, "")
