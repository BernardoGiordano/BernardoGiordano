import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { group } from '@core/forms/group.js';
import { maxLength, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { CONTENT } from '../services/content-service.js';

/** @import { SiteLink } from '../services/types.js' */

/** One rail link. Its own component so the row form and the add form are one form. */
export class LinkForm extends EditorElement {
  static properties = {
    record: { attribute: false },
  };

  /** @type {SiteLink | null} */
  record = null;

  /** @type {SiteLink | null} */
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

  save() {
    const values = this.form.values;
    const body = { kind: values.kind.trim(), label: values.label.trim(), url: values.url.trim() };
    const content = inject(CONTENT);
    const record = this.record;
    this.commit(this.form, () => (record === null ? content.addLink(body) : content.saveLink(record.id, body)));
  }
}

/** @param {SiteLink | null} record */
function buildForm(record) {
  return group({
    label: field(record?.label ?? '', [required(), maxLength(64)]),
    url: field(record?.url ?? '', [required(), maxLength(512)]),
    kind: field(record?.kind ?? 'link', [maxLength(32)]),
  });
}

await defineComponent({
  tag: 'link-form',
  element: LinkForm,
  module: import.meta.url,
  uses: [UiField],
});
