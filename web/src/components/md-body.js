/**
 * Markdown, rendered.
 *
 * THE ONE innerHTML WRITE IN THIS APPLICATION, AND WHY IT IS HERE.
 *
 * srl's template dialect sanitises every sink it can reach, but it cannot reach
 * this one: a property binding lowercases and camelCases its target, so
 * `[.inner-html]` assigns `innerHtml` and `[.innerHTML]` assigns `innerhtml` —
 * neither is a DOM property. Rather than bypass the dialect's security context
 * from a template, the write lives in application code where it is one reviewable
 * line, guarded by DOMPurify with an explicit allow-list.
 *
 * `marked` and `dompurify` are imported lazily: they are ~170 KB of parser that
 * only the blog tab needs, and the projects, art and CV tabs should not pay for
 * it.
 */

import { t } from '@core/localization/i18n.js';

import { collectedFootnotes, footnotes } from './md-footnotes.js';
import { openImageViewer } from './image-viewer.js';

/** @type {Promise<{ render: (markdown: string) => string }> | null} */
let renderer = null;

/**
 * How big an image is drawn, asked for by the author as a fragment on the image
 * URL: `![alt](/media/x.webp#small "caption")`. A fragment rather than raw HTML
 * in the post, because the tag allow-list below would strip attributes off it
 * anyway, and rather than a query parameter, because the media pipeline emits
 * fixed widths and this is a layout decision made per post.
 */
const SIZES = new Map([
  ['small', 'md-img-small'],
  ['medium', 'md-img-medium'],
  ['wide', 'md-img-wide'],
]);

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'del', 's', 'code', 'pre', 'kbd', 'sup', 'sub',
  'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'span', 'div',
];

const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'width', 'height', 'loading', 'decoding', 'colspan', 'rowspan', 'align', 'lang', 'dir', 'class'];

/**
 * The endnotes, as the markup a post cannot write for itself: a rule and an
 * ordered list at the foot of the piece. Every note is inline content —
 * `parseInline` rather than `parse`, so a one-sentence note is a list item and
 * not a list item with a paragraph inside it.
 *
 * The ids and the two anchors that make a footnote a footnote are added after
 * DOMPurify has run, in `#decorateFootnotes`.
 *
 * @param {(markdown: string) => string} parseInline
 * @returns {string}
 */
function endnotes(parseInline) {
  const notes = collectedFootnotes();
  if (notes.length === 0) return '';
  const items = notes.map((note) => `<li>${parseInline(note.markdown)}</li>`).join('');
  return `<div class="md-footnotes"><hr /><ol>${items}</ol></div>`;
}

function loadRenderer() {
  renderer ??= Promise.all([import('marked'), import('dompurify')]).then(([{ marked }, { default: purify }]) => {
    marked.setOptions({ gfm: true, breaks: false });
    marked.use(footnotes);

    purify.addHook('afterSanitizeAttributes', (node) => {
      if (!(node instanceof Element)) return;
      if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('http') === true) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.tagName === 'IMG') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
      }
    });

    return {
      render: (markdown) => {
        // The body first, then the notes it turned out to refer to: the order is
        // the requirement, not a preference. `collectedFootnotes` reads state
        // this parse filled in, and the next call into `marked` clears it.
        const body = /** @type {string} */ (marked.parse(markdown));
        return purify.sanitize(body + endnotes((note) => marked.parseInline(note)), {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          ALLOW_DATA_ATTR: false,
          ADD_URI_SAFE_ATTR: [],
        });
      },
    };
  });
  return renderer;
}

export class MdBody extends HTMLElement {
  static observedAttributes = ['markdown'];

  #markdown = '';

  /** Bump per assignment so a slow render cannot overwrite a newer one. */
  #generation = 0;

  constructor() {
    super();
    // One delegated listener rather than one per image: every render replaces
    // the children, and a listener per image is a listener per render to attach.
    this.addEventListener('click', (event) => this.#onClick(event));
  }

  get markdown() {
    return this.#markdown;
  }

  /** @param {string} value */
  set markdown(value) {
    const next = typeof value === 'string' ? value : '';
    if (next === this.#markdown) return;
    this.#markdown = next;
    void this.#render();
  }

  /**
   * @param {string} name
   * @param {string | null} _old
   * @param {string | null} value
   */
  attributeChangedCallback(name, _old, value) {
    if (name === 'markdown') this.markdown = value ?? '';
  }

  async #render() {
    const generation = ++this.#generation;

    if (this.#markdown === '') {
      this.replaceChildren();
      return;
    }

    const { render } = await loadRenderer();
    if (generation !== this.#generation) return;

    this.innerHTML = render(this.#markdown);
    this.#decorateImages();
    this.#decorateFootnotes();
  }

  /**
   * A photograph in a post is a thumbnail of what was uploaded — 420px of a
   * 64ch column — so clicking one opens it at the size of the window. The
   * pointer says so first: `.md-img` is `zoom-in`.
   *
   * @param {Event} event
   */
  #onClick(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('md-img')) return;
    openImageViewer({
      source: image.currentSrc === '' ? image.src : image.currentSrc,
      alt: image.alt,
      caption: image.closest('figure')?.querySelector('figcaption')?.textContent ?? '',
    });
  }

  /**
   * What makes a superscript a footnote: an id to come back to, a link to the
   * note, an id on the note and a link back. All four are attributes, and they
   * are set here rather than written into the markup `md-footnotes` emits,
   * because an `id` a post could write for itself is a DOM-clobbering surface
   * and DOMPurify's allow-list is the thing keeping it out.
   *
   * The number is read off the marker rather than counted here: a note referred
   * to twice carries the same number in both places, so the second marker is not
   * the second note.
   */
  #decorateFootnotes() {
    const seen = new Set();

    for (const marker of this.querySelectorAll('sup.md-fn-ref')) {
      const number = marker.textContent ?? '';
      const link = document.createElement('a');
      link.setAttribute('href', `#md-fn-${number}`);
      link.setAttribute('role', 'doc-noteref');
      link.textContent = number;
      marker.replaceChildren(link);
      // Only the first reference can own the id the note links back to.
      if (seen.has(number)) continue;
      seen.add(number);
      marker.id = `md-fnref-${number}`;
    }

    const list = this.querySelector('.md-footnotes > ol');
    if (list === null) return;
    this.querySelector('.md-footnotes')?.setAttribute('role', 'doc-endnotes');

    [...list.children].forEach((note, index) => {
      const number = String(index + 1);
      note.id = `md-fn-${number}`;

      const back = document.createElement('a');
      back.className = 'md-fn-back';
      back.setAttribute('href', `#md-fnref-${number}`);
      back.setAttribute('role', 'doc-backlink');
      back.setAttribute('aria-label', t('blog.footnoteBack', { number }));
      back.textContent = '\u21a9';
      // A non-breaking space, so the arrow never begins a line of its own.
      note.append(document.createTextNode('\u00a0'), back);
    });
  }

  /**
   * The size fragment becomes a class, and an image that is the whole of its
   * paragraph becomes a `figure` with its markdown title as the caption — which
   * is where a caption belongs, and where the previous rendering left it as a
   * tooltip nobody on a phone can see. Several images in one paragraph are a
   * group the author wrote as a group, so they are laid out as one.
   *
   * Nodes are moved, never re-parsed: this runs on output DOMPurify has already
   * sanitized, and re-serialising it would be a second `innerHTML` write.
   */
  #decorateImages() {
    for (const image of this.querySelectorAll('img')) {
      const source = image.getAttribute('src') ?? '';
      const hash = source.indexOf('#');
      if (hash !== -1) {
        image.setAttribute('src', source.slice(0, hash));
        const size = SIZES.get(source.slice(hash + 1).toLowerCase());
        if (size !== undefined) image.classList.add(size);
      }
      image.classList.add('md-img');
    }

    for (const paragraph of this.querySelectorAll('p')) {
      const images = [...paragraph.children].filter((child) => child instanceof HTMLImageElement);
      const onlyImages =
        images.length === paragraph.childElementCount &&
        images.length > 0 &&
        (paragraph.textContent ?? '').trim() === '';
      if (!onlyImages) continue;

      const figures = images.map((image) => this.#toFigure(image));
      if (figures.length === 1) {
        paragraph.replaceWith(figures[0]);
        continue;
      }

      const gallery = document.createElement('div');
      gallery.className = 'md-gallery';
      gallery.append(...figures);
      paragraph.replaceWith(gallery);
    }
  }

  /**
   * One image as a figure: a rectangular box of the page's own proportions, the
   * photograph inside it whole rather than cropped to fit, and the same image
   * blurred and darkened behind it filling whatever the shape leaves over. A
   * square photograph in a wide box is the case this exists for.
   *
   * The size class moves from the image to the box, because it is the box's
   * height it decides now.
   *
   * @param {HTMLImageElement} image
   * @returns {HTMLElement}
   */
  #toFigure(image) {
    const caption = image.getAttribute('title') ?? '';
    image.removeAttribute('title');

    const frame = document.createElement('div');
    frame.className = 'md-frame';
    for (const size of SIZES.values()) {
      if (!image.classList.contains(size)) continue;
      image.classList.remove(size);
      frame.classList.add(size);
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'md-frame-fill';
    backdrop.setAttribute('aria-hidden', 'true');
    // A quote is the one character that could leave the url() it is written
    // into; the address itself has already been through DOMPurify.
    backdrop.style.backgroundImage = `url("${(image.getAttribute('src') ?? '').replaceAll('"', '%22')}")`;

    frame.append(backdrop, image);

    const figure = document.createElement('figure');
    figure.append(frame);
    if (caption !== '') {
      const legend = document.createElement('figcaption');
      legend.textContent = caption;
      figure.append(legend);
    }
    return figure;
  }
}

customElements.define('md-body', MdBody);
