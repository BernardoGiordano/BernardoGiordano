import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { fieldArray } from '@core/forms/array.js';
import { group } from '@core/forms/group.js';
import { maxLength, pattern, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { ImageField } from './image-field.js';
import { ART } from '../services/art-service.js';
import { dateInputValue, listToText, textToList, todayIso } from '../forms.js';

/** @import { ArtWork } from '../services/types.js' */

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const DIGITS = /^\d+$/u;

export class ArtEditor extends EditorElement {
  static properties = {
    record: { attribute: false },
  };

  /** @type {ArtWork | null} */
  record = null;

  /** @type {ArtWork | null} */
  #built = null;

  form = buildForm(null);

  /** @param {Map<PropertyKey, unknown>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    if (this.record !== this.#built) {
      this.#built = this.record;
      this.form = buildForm(this.record);
    }
  }

  addLink() {
    this.form.fields.links.push({ label: '', url: '' });
  }

  /** @param {number} index */
  removeLink(index) {
    this.form.fields.links.removeAt(index);
  }

  save() {
    const values = this.form.values;
    /** @type {Partial<ArtWork>} */
    const patch = {
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      description: values.description,
      kind: values.kind.trim(),
      label: values.label.trim(),
      releasedOn: values.releasedOn,
      formats: textToList(values.formats),
      coverUrl: values.coverUrl,
      bandcampAlbumId: values.bandcampAlbumId.trim(),
      catalogNumber: values.catalogNumber.trim(),
      links: values.links
        .filter((link) => link.url.trim() !== '')
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
      // `tracks` is deliberately absent. The page no longer draws a tracklist —
      // the Bandcamp player already names the tracks — so this form no longer
      // edits one, and a patch that omitted the key by accident would be a patch
      // that emptied the column. api/ leaves an absent key alone; every row that
      // still has tracks keeps them.
    };

    const art = inject(ART);
    const record = this.record;
    this.commit(this.form, () => (record === null ? art.create(patch) : art.save(record.id, patch)));
  }
}

/** @param {ArtWork | null} record */
function buildForm(record) {
  return group({
    title: field(record?.title ?? '', [required(), maxLength(255)]),
    subtitle: field(record?.subtitle ?? '', [maxLength(255)]),
    description: field(record?.description ?? ''),
    kind: field(record?.kind ?? '', [maxLength(32)]),
    label: field(record?.label ?? '', [maxLength(128)]),
    releasedOn: field(dateInputValue(record?.releasedOn) || todayIso(), [required(), pattern(DAY)]),
    formats: field(listToText(record?.formats)),
    coverUrl: field(record?.coverUrl ?? '', [maxLength(512)]),
    bandcampAlbumId: field(record?.bandcampAlbumId ?? '', [pattern(DIGITS), maxLength(32)]),
    catalogNumber: field(record?.catalogNumber ?? '', [maxLength(64)]),
    links: fieldArray(
      () =>
        group({
          label: field('', [required(), maxLength(64)]),
          url: field('', [required(), maxLength(512)]),
        }),
      (record?.links ?? []).map((link) => ({ label: link.label, url: link.url })),
    ),
  });
}

await defineComponent({
  tag: 'art-editor',
  element: ArtEditor,
  module: import.meta.url,
  uses: [UiField, ImageField],
});
