import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';

import { CONTENT } from '../services/content-service.js';
import { PROJECTS } from '../services/projects-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { ProjectEditor } from '../components/project-editor.js';
import { RowTools } from '../components/row-tools.js';
import { compactNumber, relativeTime } from '../format.js';
import { failureKey, moved } from '../forms.js';

/** @import { Project } from '../services/types.js' */

/** No row has this id, so it is the one that means "the row being added". */
const NEW_ROW = 0;

export class ProjectsPage extends SignalElement {
  /** The row whose editor is open: an id, `NEW_ROW`, or -1 for none. */
  editing = signal(-1);

  /** The row a delete, reorder or refresh is in flight for. */
  busyId = signal(-1);

  errorKey = signal('');

  onMount() {
    // The rail already asks for this list on every page; the guard on
    // `isLoading` is what keeps landing on /projects from asking twice.
    const projects = inject(PROJECTS);
    if (!projects.loaded.value && !projects.isLoading.value) void projects.load();
  }

  get rows() {
    return inject(PROJECTS).rows;
  }

  get isLoading() {
    return inject(PROJECTS).isLoading;
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /** @param {Project} project */
  downloads(project) {
    return project.downloadsOverride ?? project.stats?.downloads ?? null;
  }

  /**
   * The row's one muted line: what it runs on, an em dash, and what it has done.
   * Built here rather than as eight conditional spans in the template because
   * the separators depend on which parts exist — a middot with nothing after it
   * is the thing that makes a generated line look generated.
   *
   * @param {Project} project
   */
  facts(project) {
    const left = [...project.platforms];
    if (project.kind !== '') left.push(this.#capitalise(project.kind));

    const right = [t(project.openSource ? 'projects.openSource' : 'projects.closedSource')];
    // Stars lead the numbers. They used to sit inside the star button, where a
    // count is not what a button is for: the invitation is the same on every
    // row and the number is not, so the number is a fact and belongs with the
    // other facts GitHub reported. Zero is left out for the reason a fork count
    // of zero is — a stat nobody has yet is not a stat.
    if (project.stats?.stars) right.push(t('projects.starsCount', { count: compactNumber(project.stats.stars) }));
    const downloads = this.downloads(project);
    if (downloads !== null && downloads > 0) {
      right.push(t('projects.downloadsCount', { count: compactNumber(downloads) }));
    }
    if (project.stats?.forks) right.push(t('projects.forksCount', { count: compactNumber(project.stats.forks) }));
    if (project.stats?.lastReleaseAt) {
      right.push(t('projects.lastRelease', { when: relativeTime(project.stats.lastReleaseAt) }));
    }
    if (project.stats?.firstCommitAt) {
      right.push(t('projects.since', { year: project.stats.firstCommitAt.slice(0, 4) }));
    }

    const parts = [left.join(' \u00b7 '), right.join(' \u00b7 ')].filter((part) => part !== '');
    return parts.join(' \u2014 ');
  }

  /** The accent is for what is alive; everything else is muted. */
  /** @param {Project} project */
  statusClasses(project) {
    return project.status === 'archived' ? 'text-ink/52' : 'text-accent';
  }

  /** The profile's own GitHub address, for the row under the list. */
  get githubUrl() {
    return inject(CONTENT).links.value.find((link) => link.kind === 'github')?.url ?? '';
  }

  /** @param {string} value */
  #capitalise(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  /** @param {Project} project */
  statusLabel(project) {
    return t(`projects.status${project.status.charAt(0).toUpperCase()}${project.status.slice(1)}`);
  }

  /** @param {Project} project */
  repoUrl(project) {
    return project.repo === '' ? '' : `https://github.com/${project.repo}`;
  }

  /**
   * Where the row goes when it is clicked. A project with no page of its own
   * still has a repository, and a row that answers the pointer and then does
   * nothing is worse than one that never offered.
   *
   * @param {Project} project
   */
  cardUrl(project) {
    return project.url === '' ? this.repoUrl(project) : project.url;
  }

  /* ── Editing ────────────────────────────────────────────────────────────── */

  get isCreating() {
    return this.editing.value === NEW_ROW;
  }

  /** @param {Project} project */
  isEditing(project) {
    return this.editing.value === project.id;
  }

  /** @param {Project} project */
  isBusy(project) {
    return this.busyId.value === project.id;
  }

  /** @param {Project} project */
  canMoveUp(project) {
    return this.rows.value.indexOf(project) > 0;
  }

  /** @param {Project} project */
  canMoveDown(project) {
    const rows = this.rows.value;
    return rows.indexOf(project) < rows.length - 1;
  }

  openNew() {
    this.errorKey.value = '';
    this.editing.value = NEW_ROW;
  }

  /** @param {Project} project */
  open(project) {
    this.errorKey.value = '';
    this.editing.value = project.id;
  }

  close() {
    this.editing.value = -1;
  }

  /** @param {Project} project */
  discard(project) {
    this.#write(project, () => inject(PROJECTS).remove(project.id));
  }

  /**
   * @param {Project} project
   * @param {-1 | 1} delta
   */
  move(project, delta) {
    const ids = moved(
      this.rows.value.map((row) => row.id),
      project.id,
      delta,
    );
    this.#write(project, () => inject(PROJECTS).reorder(ids));
  }

  /** @param {Project} project */
  refresh(project) {
    this.#write(project, () => inject(PROJECTS).refreshStats(project.id));
  }

  /**
   * @param {Project} project
   * @param {() => Promise<unknown>} write
   */
  #write(project, write) {
    this.busyId.value = project.id;
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
  tag: 'projects-page',
  element: ProjectsPage,
  module: import.meta.url,
  uses: [ProjectEditor, RowTools],
});
