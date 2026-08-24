/**
 * Footnotes for `marked`, in the syntax the posts are already written in.
 *
 * `[^1]` in a sentence and `[^1]: the note` at the foot of the file is Markdown
 * Extra's spelling, which is what Hugo's goldmark accepted and what the fifty
 * imported posts contain. `marked` has no footnotes of its own, so this is two
 * extensions — one block tokenizer for the definitions, one inline tokenizer for
 * the references — plus the order the references were met in, which is what
 * numbers them.
 *
 * The reference renders as a bare `<sup class="md-fn-ref">1</sup>`: no id, no
 * anchor, no `role`. Everything that has to be an attribute is added by
 * `md-body` after DOMPurify has run, so the allow-list stays the twenty tags and
 * the dozen attributes it already was — an `id` a post could write itself is a
 * DOM-clobbering surface, and this way the ids are the renderer's rather than the
 * author's.
 *
 * Numbering is by first reference rather than by the order the definitions are
 * written in, which is both what goldmark does and the only order the reader can
 * see. A reference with no definition is left as the literal text the author
 * typed, because a superscript pointing at nothing is worse than a visible typo.
 */

/**
 * The definitions of the document being rendered, and the labels referenced in
 * it, in order. Module state rather than a parser field because `marked` gives
 * an extension no per-parse context — which is safe here: `marked.parse` is
 * synchronous, and `preprocess` clears both before every document.
 *
 * @type {Map<string, string>}
 */
let definitions = new Map();

/** @type {string[]} */
let referenced = [];

/**
 * `[^label]: the note`, plus any continuation lines the author indented under
 * it. It stops at a blank line or at the next definition, so a run of them at
 * the foot of a post is one token each rather than one paragraph of them all —
 * which is what a post that ends in two adjacent definitions would otherwise
 * be.
 */
const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*(?:\n|\[\^))[ \t]+[^\n]*)*)(?:\n+|$)/u;

/**
 * Where a definition may start, for `marked`'s paragraph tokenizer: without it,
 * a definition on the line directly under a sentence is swallowed into that
 * paragraph. The colon is the whole point of the pattern — matching a bare `[^`
 * would cut every paragraph in half at its first reference.
 */
const DEFINITION_START = /^ {0,3}\[\^[^\]\s]+\]:/mu;

const REFERENCE = /^\[\^([^\]\s]+)\]/u;

const ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);

/** @param {string} text */
function escape(text) {
  return text.replace(/[&<>]/gu, (character) => ESCAPES.get(character) ?? character);
}

/**
 * A definition's continuation lines are indented to belong to it; the note
 * itself is not indented text.
 *
 * @param {string} text
 */
function dedent(text) {
  return text.replace(/\n[ \t]+/gu, '\n').trim();
}

/**
 * The notes the last render actually referred to, in the order it referred to
 * them. A definition nothing points at is not printed — an endnote with no
 * number beside it in the text is a dangling paragraph.
 *
 * Read this before rendering the notes themselves: parsing a note's markdown is
 * another call into `marked`, and that call's `preprocess` clears the state this
 * returns.
 *
 * @returns {{ label: string, markdown: string }[]}
 */
export function collectedFootnotes() {
  return referenced.map((label) => ({ label, markdown: definitions.get(label) ?? '' }));
}

/** @type {Parameters<import('marked').Marked['use']>[0]} */
export const footnotes = {
  extensions: [
    {
      name: 'footnoteDefinition',
      level: 'block',
      /** @param {string} source */
      start(source) {
        return DEFINITION_START.exec(source)?.index;
      },
      /** @param {string} source */
      tokenizer(source) {
        const match = DEFINITION.exec(source);
        if (match === null) return undefined;
        definitions.set(match[1], dedent(match[2]));
        // The definition is not printed where it was written. It is printed at
        // the foot of the post, by whoever asked for the render.
        return { type: 'footnoteDefinition', raw: match[0], tokens: [] };
      },
      renderer() {
        return '';
      },
    },
    {
      name: 'footnoteReference',
      level: 'inline',
      /** @param {string} source */
      start(source) {
        const at = source.indexOf('[^');
        return at === -1 ? undefined : at;
      },
      /** @param {string} source */
      tokenizer(source) {
        const match = REFERENCE.exec(source);
        if (match === null) return undefined;
        return { type: 'footnoteReference', raw: match[0], text: match[1], tokens: [] };
      },
      /** @param {{ text: string }} token */
      renderer(token) {
        const label = token.text;
        if (!definitions.has(label)) return escape(`[^${label}]`);
        if (!referenced.includes(label)) referenced.push(label);
        return `<sup class="md-fn-ref">${referenced.indexOf(label) + 1}</sup>`;
      },
    },
  ],
  hooks: {
    /** @param {string} markdown */
    preprocess(markdown) {
      definitions = new Map();
      referenced = [];
      return markdown;
    },
  },
};
