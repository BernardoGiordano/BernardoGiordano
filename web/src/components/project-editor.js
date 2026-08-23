import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { group } from '@core/forms/group.js';
import { max, maxLength, min, oneOf, pattern, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { PROJECTS } from '../services/projects-service.js';
import { listToText, textToList } from '../forms.js';

/** @import { Project } from '../services/types.js' */

const ROLES = ['author', 'maintainer', 'contributor'];
const STATUSES = ['active', 'maintained', 'archived'];

/** `owner/name`, or nothing. The same rule `ProjectBody` enforces server-side. */
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

export class ProjectEditor extends EditorElement {
  static properties = {
    record: { attribute: false },
  };

  /** @type {Project | null} The row being edited, or null for a new one. */
  record = null;

  /** @type {Project | null} What `form` was built from. */
  #built = null;

  form = buildForm(null);

  /** @param {Map<PropertyKey, unknown>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    // `record` is a Lit property, so a form built in the constructor would go on
    // editing whatever the element was created with.
    if (this.record !== this.#built) {
      this.#built = this.record;
      this.form = buildForm(this.record);
    }
  }

  get roles() {
    return ROLES;
  }

  get statuses() {
    return STATUSES;
  }

  /** @param {string} role */
  roleLabel(role) {
    return `projects.role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  }

  /** @param {string} status */
  statusLabel(status) {
    return `projects.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  }

  get isNew() {
    return this.record === null;
  }

  save() {
    const values = this.form.values;
    /** @type {Partial<Project>} */
    const patch = {
      name: values.name.trim(),
      description: values.description,
      url: values.url.trim(),
      repo: values.repo.trim(),
      kind: values.kind.trim(),
      role: values.role,
      status: values.status,
      openSource: values.openSource,
      featured: values.featured,
      platforms: textToList(values.platforms),
      tech: textToList(values.tech),
      downloadsOverride: values.downloadsOverride.trim() === '' ? null : Number(values.downloadsOverride),
    };

    const projects = inject(PROJECTS);
    const record = this.record;
    this.commit(this.form, () => (record === null ? projects.create(patch) : projects.save(record.id, patch)));
  }
}

/** @param {Project | null} record */
function buildForm(record) {
  return group({
    name: field(record?.name ?? '', [required(), maxLength(128)]),
    description: field(record?.description ?? ''),
    url: field(record?.url ?? '', [maxLength(512)]),
    repo: field(record?.repo ?? '', [pattern(REPO), maxLength(160)]),
    kind: field(record?.kind ?? '', [maxLength(32)]),
    role: field(record?.role ?? 'author', [oneOf(ROLES)]),
    status: field(record?.status ?? 'active', [oneOf(STATUSES)]),
    openSource: field(record?.openSource ?? true),
    featured: field(record?.featured ?? false),
    platforms: field(listToText(record?.platforms)),
    tech: field(listToText(record?.tech)),
    downloadsOverride: field(
      record?.downloadsOverride === null || record?.downloadsOverride === undefined
        ? ''
        : String(record.downloadsOverride),
      [min(0), max(Number.MAX_SAFE_INTEGER)],
    ),
  });
}

await defineComponent({
  tag: 'project-editor',
  element: ProjectEditor,
  module: import.meta.url,
  uses: [UiField],
});
