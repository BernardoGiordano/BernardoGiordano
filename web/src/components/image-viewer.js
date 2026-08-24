/**
 * A photograph, full screen, on a darkened page.
 *
 * A post's images are drawn inside a box of the page's proportions — whole
 * rather than cropped, which is what `md-body` builds — and a box 420px tall in
 * a 64ch column is a thumbnail of a photograph that was uploaded at three
 * widths. This is the other half of that: the picture at the size of the window,
 * with everything else turned down rather than replaced.
 *
 * A native `<dialog>` opened with `showModal`, because almost everything a
 * lightbox has to do — hold the focus inside itself, make the page behind it
 * inert, and offer a `::backdrop` to darken — the element already does. What is
 * left is four nodes and two handlers.
 *
 * One instance, built on the first open and kept, holding whichever photograph
 * was looked at last: a viewer per image is a viewer per image to collect, and
 * the fifty-image posts are the ones this exists for.
 */

import { t } from '@core/localization/i18n.js';

import { iconPath } from '../icons.js';

const SVG = 'http://www.w3.org/2000/svg';

/** @type {{ dialog: HTMLDialogElement, image: HTMLImageElement, caption: HTMLElement } | null} */
let viewer = null;

/** The close glyph, drawn rather than written: `icon()` is a template global. */
function closeGlyph() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', iconPath('x'));
  svg.append(path);
  return svg;
}

function build() {
  const dialog = document.createElement('dialog');
  dialog.className = 'img-viewer';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'img-viewer-close';
  close.append(closeGlyph());

  const figure = document.createElement('figure');
  figure.className = 'img-viewer-figure';

  const image = document.createElement('img');
  image.className = 'img-viewer-img';
  image.decoding = 'async';

  const caption = document.createElement('figcaption');
  caption.className = 'img-viewer-caption';

  figure.append(image, caption);
  dialog.append(close, figure);
  document.body.append(dialog);

  // The whole ground closes it, the picture does not: a click on the photograph
  // is the one click in here that is not "I am done looking at this". The button
  // is inside the ground, so it is the same handler.
  dialog.addEventListener('click', (event) => {
    if (event.target === image) return;
    dialog.close();
  });

  // Escape is supposed to be the element's own: `showModal` arms its cancel
  // behaviour, and closing on it is the browser's job. Not every engine that
  // renders a modal dialog implements that half of it, and the key is the way
  // out that a keyboard has, so it is handled rather than assumed.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dialog.open) return;
    event.preventDefault();
    dialog.close();
  });

  viewer = { dialog, image, caption };
  return viewer;
}

/**
 * Show one image. The caption is the figure's own — the markdown title, which
 * `md-body` already lifted out of the tooltip nobody on a phone can see.
 *
 * @param {{ source: string, alt: string, caption: string }} picture
 */
export function openImageViewer({ source, alt, caption }) {
  const { dialog, image, caption: legend } = viewer ?? build();

  dialog.setAttribute('aria-label', alt === '' ? t('blog.imageViewer') : alt);
  dialog.querySelector('.img-viewer-close')?.setAttribute('aria-label', t('site.close'));
  image.src = source;
  image.alt = alt;
  legend.textContent = caption;
  legend.hidden = caption === '';

  dialog.showModal();
}
