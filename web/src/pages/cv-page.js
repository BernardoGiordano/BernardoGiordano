import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';

import { CV } from '../services/cv-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { CvItemEditor } from '../components/cv-item-editor.js';
import { CvSectionEditor } from '../components/cv-section-editor.js';
import { RowTools } from '../components/row-tools.js';
import { failureKey, moved } from '../forms.js';

/** @import { CvItem, CvSection } from '../services/types.js' */

/** No row has this id, so it is the one that means "the row being added". */
const NEW_ROW = 0;

export class CvPage extends SignalElement {
  /** The section whose header is being edited: an id, `NEW_ROW`, or -1. */
  editingSection = signal(-1);

  /** The entry being edited, and the section it is in. */
  editingItem = signal(-1);
  itemSection = signal(-1);

  busyId = signal(-1);
  errorKey = signal('');

  onMount() {
    if (!inject(CV).loaded.value) void inject(CV).load();
  }

  get sections() {
    return inject(CV).sections;
  }

  get isLoading() {
    return inject(CV).isLoading;
  }

  get failed() {
    return inject(CV).failed;
  }

  /** What the failure line's button asks for. */
  retry() {
    void inject(CV).load();
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /* ── Sections ───────────────────────────────────────────────────────────── */

  get isAddingSection() {
    return this.editingSection.value === NEW_ROW;
  }

  /** @param {CvSection} section */
  isEditingSection(section) {
    return this.editingSection.value === section.id;
  }

  /** @param {CvSection} section */
  isBusy(section) {
    return this.busyId.value === section.id;
  }

  /** @param {CvSection} section */
  canMoveUp(section) {
    return this.sections.value.indexOf(section) > 0;
  }

  /** @param {CvSection} section */
  canMoveDown(section) {
    const sections = this.sections.value;
    return sections.indexOf(section) < sections.length - 1;
  }

  addSection() {
    this.#reset();
    this.editingSection.value = NEW_ROW;
  }

  /** @param {CvSection} section */
  editSection(section) {
    this.#reset();
    this.editingSection.value = section.id;
  }

  /** @param {CvSection} section */
  removeSection(section) {
    this.#write(section.id, () => inject(CV).removeSection(section.id));
  }

  /**
   * @param {CvSection} section
   * @param {-1 | 1} delta
   */
  moveSection(section, delta) {
    const ids = moved(
      this.sections.value.map((row) => row.id),
      section.id,
      delta,
    );
    this.#write(section.id, () => inject(CV).reorderSections(ids));
  }

  /* ── Entries ────────────────────────────────────────────────────────────── */

  /** @param {CvSection} section */
  isAddingItem(section) {
    return this.editingItem.value === NEW_ROW && this.itemSection.value === section.id;
  }

  /** @param {CvItem} item */
  isEditingItem(item) {
    return this.editingItem.value === item.id;
  }

  /** @param {CvItem} item */
  isItemBusy(item) {
    return this.busyId.value === item.id;
  }

  /** @param {CvSection} section */
  addItem(section) {
    this.#reset();
    this.itemSection.value = section.id;
    this.editingItem.value = NEW_ROW;
  }

  /**
   * @param {CvSection} section
   * @param {CvItem} item
   */
  editItem(section, item) {
    this.#reset();
    this.itemSection.value = section.id;
    this.editingItem.value = item.id;
  }

  /**
   * @param {CvSection} section
   * @param {CvItem} item
   */
  removeItem(section, item) {
    this.#write(item.id, () => inject(CV).removeItem(section.id, item.id));
  }

  /**
   * @param {CvSection} section
   * @param {CvItem} item
   * @param {-1 | 1} delta
   */
  moveItem(section, item, delta) {
    const ids = moved(
      section.items.map((row) => row.id),
      item.id,
      delta,
    );
    this.#write(item.id, () => inject(CV).reorderItems(section.id, ids));
  }

  /**
   * @param {CvSection} section
   * @param {CvItem} item
   */
  canItemUp(section, item) {
    return section.items.indexOf(item) > 0;
  }

  /**
   * @param {CvSection} section
   * @param {CvItem} item
   */
  canItemDown(section, item) {
    return section.items.indexOf(item) < section.items.length - 1;
  }

  /** One editor open at a time: two forms over the same CV is two answers to it. */
  close() {
    this.#reset();
  }

  #reset() {
    this.errorKey.value = '';
    this.editingSection.value = -1;
    this.editingItem.value = -1;
    this.itemSection.value = -1;
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
  tag: 'cv-page',
  element: CvPage,
  module: import.meta.url,
  uses: [CvItemEditor, CvSectionEditor, RowTools],
});
