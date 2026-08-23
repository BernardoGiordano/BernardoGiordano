import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { group } from '@core/forms/group.js';
import { maxLength, oneOf, pattern, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { ImageField } from './image-field.js';
import { MdEditor } from './md-editor.js';
import { BLOG } from '../services/blog-service.js';
import { dateInputValue, listToText, slugify, textToList, todayIso } from '../forms.js';

/** @import { Post } from '../services/types.js' */

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LANGUAGES = ['it', 'en'];

export class PostEditor extends EditorElement {
  static properties = {
    record: { attribute: false },
  };

  /** @type {Post | null} */
  record = null;

  /** @type {Post | null} */
  #built = null;

  /** Whether the slug has been typed in. Until it has, it follows the title. */
  #slugOwned = false;

  form = buildForm(null);

  /** @param {Map<PropertyKey, unknown>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    if (this.record !== this.#built) {
      this.#built = this.record;
      this.#slugOwned = this.record !== null;
      this.form = buildForm(this.record);
    }
  }

  get languages() {
    return LANGUAGES;
  }

  /** What the page's navigation guard asks before it leaves. */
  get isDirty() {
    return this.form.dirty.value;
  }

  /**
   * A new post's address follows its title until somebody types one. An existing
   * post's never does: its slug is a URL other people already have.
   *
   * @param {Event} event
   */
  titleTyped(event) {
    if (this.#slugOwned) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.form.fields.slug.setValue(slugify(input.value));
  }

  slugTyped() {
    this.#slugOwned = true;
  }

  save() {
    const values = this.form.values;
    /** @type {Partial<Post>} */
    const patch = {
      slug: values.slug.trim(),
      title: values.title.trim(),
      summary: values.summary,
      body: values.body,
      coverUrl: values.coverUrl,
      language: values.language,
      publishedOn: values.publishedOn,
      draft: values.draft,
      tags: textToList(values.tags).map((tag) => tag.toLowerCase()),
    };

    const blog = inject(BLOG);
    const record = this.record;
    this.commit(this.form, () => (record === null ? blog.create(patch) : blog.save(record.id, patch)));
  }
}

/** @param {Post | null} record */
function buildForm(record) {
  return group({
    title: field(record?.title ?? '', [required(), maxLength(255)]),
    slug: field(record?.slug ?? '', [required(), pattern(SLUG), maxLength(200)]),
    summary: field(record?.summary ?? ''),
    publishedOn: field(dateInputValue(record?.publishedOn) || todayIso(), [required(), pattern(DAY)]),
    language: field(record?.language ?? 'it', [oneOf(LANGUAGES)]),
    tags: field(listToText(record?.tags)),
    coverUrl: field(record?.coverUrl ?? '', [maxLength(512)]),
    draft: field(record?.draft ?? false),
    body: field(record?.body ?? ''),
  });
}

await defineComponent({
  tag: 'post-editor',
  element: PostEditor,
  module: import.meta.url,
  uses: [UiField, ImageField, MdEditor],
});
