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

function loadRenderer() {
  renderer ??= Promise.all([import('marked'), import('dompurify')]).then(([{ marked }, { default: purify }]) => {
    marked.setOptions({ gfm: true, breaks: false });

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
      render: (markdown) =>
        purify.sanitize(/** @type {string} */ (marked.parse(markdown)), {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          ALLOW_DATA_ATTR: false,
          ADD_URI_SAFE_ATTR: [],
        }),
    };
  });
  return renderer;
}

export class MdBody extends HTMLElement {
  static observedAttributes = ['markdown'];

  #markdown = '';

  /** Bump per assignment so a slow render cannot overwrite a newer one. */
  #generation = 0;

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
