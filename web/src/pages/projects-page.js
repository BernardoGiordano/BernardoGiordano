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
   * The plain chips: what it runs on, what kind of thing it is, and what the
   * licence is. Facts with no number in them, so they carry no icon — a glyph
   * beside "Nintendo 3DS" would be decoration, and the row already has five
   * other chips competing for the eye.
   *
   * One array rather than three loops in the template because the separators
   * are gone: what used to be a generated line with middots in it — and a
   * middot with nothing after it is what makes a generated line look
   * generated — is now one chip per fact, and a chip that has nothing to say
   * is simply absent.
   *
   * @param {Project} project
   */
  tags(project) {
    const tags = [...project.platforms];
    if (project.kind !== '') tags.push(this.#capitalise(project.kind));
    tags.push(this.#licence(project));
    return tags;
  }

  /**
   * The licence GitHub reports, in place of the words "Open source". Both say
   * the source is open; only one says what may be done with it, which is the
   * question anybody reading that chip actually has — and an SPDX id is four
   * characters where the phrase was eleven.
   *
   * The phrase survives as the fallback, for a repository whose licence the
   * poller could not read and for the projects that have no repository at all.
   * A row that simply dropped the chip would read as closed source.
   *
   * @param {Project} project
   */
  #licence(project) {
    if (!project.openSource) return t('projects.closedSource');
    const licence = project.stats?.license ?? '';
    return licence === '' ? t('projects.openSource') : licence;
  }

  /**
   * The star count, on its own, for the chip that is also the invitation to add
   * one. Zero is left out for the reason a fork count of zero is: a stat nobody
   * has yet is not a stat, and "0" beside a gold star reads as a verdict.
   *
   * @param {Project} project
   */
  starCount(project) {
    const stars = project.stats?.stars ?? 0;
    if (stars === 0 || this.repoUrl(project) === '') return '';
    return compactNumber(stars);
  }

  /**
   * What the star chip is called, since what it shows is a number and what it
   * does is not obvious from one: the count first, because that is what the
   * pointer is over, then the action.
   *
   * @param {Project} project
   */
  starLabel(project) {
    return t('projects.starCta', { count: compactNumber(project.stats?.stars ?? 0) });
  }

  /**
   * The chips that carry a number: the figure in the mono face with tabular
   * figures, and a small coloured mark to say which figure it is. The word the
   * number used to be followed by moves to the chip's title — at 11px, six
   * labelled counts in a row are a paragraph, and the icon says the same thing
   * in one glyph.
   *
   * @param {Project} project
   */
  metrics(project) {
    /** @type {{ key: string, text: string, icon: string, mark: string, label: string }[]} */
    const metrics = [];

    const downloads = this.downloads(project);
    if (downloads !== null && downloads > 0) {
      metrics.push({
        key: 'downloads',
        text: compactNumber(downloads),
        icon: 'download',
        mark: 'mark-downloads',
        label: t('projects.downloadsCount', { count: compactNumber(downloads) }),
      });
    }

    if (project.stats?.forks) {
      metrics.push({
        key: 'forks',
        text: compactNumber(project.stats.forks),
        icon: 'gitFork',
        mark: 'mark-forks',
        label: t('projects.forksCount', { count: compactNumber(project.stats.forks) }),
      });
    }

    if (project.stats?.lastReleaseAt) {
      // The tag and when it went out are one fact — "v5.1.0, twelve days ago" —
      // and a version with no date is trivia while a date with no version does
      // not say what shipped. A repository that tags nothing keeps the date on
      // its own.
      const when = relativeTime(project.stats.lastReleaseAt);
      const tag = project.stats.lastReleaseTag ?? '';
      metrics.push({
        key: 'release',
        text: tag === '' ? when : `${tag} ${when}`,
        icon: 'clock',
        mark: 'mark-quiet',
        label: tag === '' ? t('projects.lastRelease', { when }) : t('projects.lastReleaseTagged', { tag, when }),
      });
    }

    if (project.stats?.firstCommitAt) {
      const year = project.stats.firstCommitAt.slice(0, 4);
      metrics.push({
        key: 'since',
        text: year,
        icon: 'calendar',
        mark: 'mark-quiet',
        label: t('projects.since', { year }),
      });
    }

    return metrics;
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
