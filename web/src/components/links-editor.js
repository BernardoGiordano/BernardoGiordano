import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';

import { LinkForm } from './link-form.js';
import { RowTools } from './row-tools.js';
import { CONTENT } from '../services/content-service.js';
import { socialHandle } from '../format.js';
import { failureKey, moved } from '../forms.js';

/** @import { SiteLink } from '../services/types.js' */

/** No row has this id, so it is the one that means "the row being added". */
const NEW_ROW = 0;

/**
 * The rail's links, edited in the rail: one row's form open at a time, which is
 * what keeps this inside a 232-pixel column.
 */
export class LinksEditor extends SignalElement {
  editing = signal(-1);
  busyId = signal(-1);
  errorKey = signal('');

  get links() {
    return inject(CONTENT).links;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /**
   * The same handle the rail shows, so editing a link's address is edited
   * against what the reader sees rather than against its label.
   *
   * @param {SiteLink} link
   */
  handle(link) {
    return socialHandle(link.url) || link.label;
  }

  get isAdding() {
    return this.editing.value === NEW_ROW;
  }

  /** @param {SiteLink} link */
  isEditing(link) {
    return this.editing.value === link.id;
  }

  /** @param {SiteLink} link */
  isBusy(link) {
    return this.busyId.value === link.id;
  }

  /** @param {SiteLink} link */
  canMoveUp(link) {
    return this.links.value.indexOf(link) > 0;
  }

  /** @param {SiteLink} link */
  canMoveDown(link) {
    const links = this.links.value;
    return links.indexOf(link) < links.length - 1;
  }

  openNew() {
    this.errorKey.value = '';
    this.editing.value = NEW_ROW;
  }

  /** @param {SiteLink} link */
  open(link) {
    this.errorKey.value = '';
    this.editing.value = link.id;
  }

  close() {
    this.editing.value = -1;
  }

  /** @param {SiteLink} link */
  discard(link) {
    this.#write(link.id, () => inject(CONTENT).removeLink(link.id));
  }

  /**
   * @param {SiteLink} link
   * @param {-1 | 1} delta
   */
  move(link, delta) {
    const ids = moved(
      this.links.value.map((row) => row.id),
      link.id,
      delta,
    );
    this.#write(link.id, () => inject(CONTENT).reorderLinks(ids));
  }

  /**
   * @param {number} id
   * @param {() => Promise<unknown>} write
   */
  #write(id, write) {
    this.busyId.value = id;
    this.errorKey.value = '';
    void write()
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busyId.value = -1;
      });
  }
}

await defineComponent({
  tag: 'links-editor',
  element: LinksEditor,
  module: import.meta.url,
  uses: [LinkForm, RowTools],
});
