import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { effect, signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { currentPath, navigate } from '@core/navigation/router.js';
import { setTheme, theme } from '@core/appearance/theme.js';
import { AUTH_SESSION } from '@auth/session.js';
import { t } from '@core/localization/i18n.js';

import { CONTENT } from '../services/content-service.js';
import { compactNumber, socialHandle } from '../format.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { VISITS } from '../services/visits-service.js';
import { LinksEditor } from '../components/links-editor.js';
import { ProfileCard } from '../components/profile-card.js';

const TABS = [
  { key: 'projects', path: '/projects' },
  { key: 'art', path: '/art' },
  { key: 'cv', path: '/cv' },
  { key: 'blog', path: '/blog' },
];

/**
 * The frame: a rail that does not move and a column that does. It is a layout
 * route, so both survive every tab change and only /login renders without them.
 */
export class ShellLayout extends SignalElement {
  copied = signal(false);

  onMount() {
    // One request for the whole shell, totals included. This used to also load
    // the entire project list on every page, because the totals were that list
    // added up on the client — and /projects was the only page that needed it.
    void inject(CONTENT).load();

    // The shell outlives every tab change, so the section counter belongs here
    // and not on four pages. An effect because `activeTab` reads the router's
    // path signal: the layout is not remounted when the tab changes, and a hook
    // would count the tab the site was opened on and nothing after it. The
    // service sends each section once per page session, so this fires again only
    // for a section not yet visited.
    const stop = effect(() => {
      inject(VISITS).record('tab', this.activeTab);
    });
    this.lifetime.addEventListener('abort', stop);
  }

  get tabs() {
    return TABS;
  }

  get profile() {
    return inject(CONTENT).profile;
  }

  get links() {
    return inject(CONTENT).links;
  }

  get canEdit() {
    return inject(EDIT_MODE).canEdit;
  }

  /**
   * The site's two numbers: every star and every counted download across both
   * accounts the backend sweeps, forks excluded.
   *
   * Read rather than computed. They were the project list added up, which was
   * the wrong sum twice over: the list is a curation of the handful of things
   * worth a paragraph, and the rest of the account — thirty-odd repositories
   * carrying a fifth of the stars between them — counted for nothing. The
   * backend sums `owned_repos`, and `downloadsOverride` no longer enters into
   * it: an override is one project card's correction, not a fact about an
   * account, and adding it to a total of what GitHub reported would be counting
   * one repository twice.
   */
  get totalStars() {
    return inject(CONTENT).totals.value?.stars ?? 0;
  }

  get totalDownloads() {
    return inject(CONTENT).totals.value?.downloads ?? 0;
  }

  /**
   * The totals are the project list's own figure, so they belong to that tab
   * and to no other: on /art or /cv the line is a number about something the
   * page does not show.
   */
  get hasTotals() {
    return this.activeTab === 'projects' && (this.totalStars > 0 || this.totalDownloads > 0);
  }

  /**
   * The same two numbers as one line for the end of the tab bar. Joined here
   * rather than as two spans in the template because the middot between them
   * belongs to neither: a project list with no downloads would otherwise render
   * a separator with nothing after it.
   */
  get totalsLine() {
    const parts = [];
    if (this.totalStars > 0) {
      parts.push(`${compactNumber(this.totalStars)} ${t('projects.totalStars')}`);
    }
    if (this.totalDownloads > 0) {
      parts.push(`${compactNumber(this.totalDownloads)} ${t('projects.totalDownloads')}`);
    }
    return parts.join(' \u00b7 ');
  }

  /**
   * The handle for a rail link, falling back to its label. The icon beside it
   * already says which network it is, so `in/bernardogiordano` is the row's only
   * new information and `LinkedIn` was none of it. The label stays as the row's
   * `title`, and is what shows for an address that names no handle.
   *
   * @param {import('../services/types.js').SiteLink} link
   */
  handle(link) {
    return socialHandle(link.url) || link.label;
  }

  get isEditing() {
    return inject(EDIT_MODE).isOn;
  }

  get themeName() {
    return theme.value;
  }

  /** The tab whose section the current URL is inside, blog posts included. */
  get activeTab() {
    const path = currentPath.value;
    return this.tabs.find((tab) => path === tab.path || path.startsWith(`${tab.path}/`))?.key ?? '';
  }

  /** The mark under the active tab is a gradient element, so this is only the
   * label's colour.
   *
   * @param {string} key
   */
  tabClasses(key) {
    return this.activeTab === key ? 'text-brand' : 'text-ink/55 hover:text-ink';
  }

  toggleTheme() {
    const order = /** @type {const} */ (['system', 'light', 'dark']);
    const next = order[(order.indexOf(theme.value) + 1) % order.length];
    setTheme(next);
  }

  get themeIcon() {
    return { light: 'sun', dark: 'moon', system: 'monitor' }[this.themeName] ?? 'monitor';
  }

  toggleEditing() {
    inject(EDIT_MODE).toggle();
  }

  copyEmail() {
    const email = this.profile.value?.email ?? '';
    if (email === '') return;
    void navigator.clipboard.writeText(email).then(() => {
      this.copied.value = true;
      setTimeout(() => {
        this.copied.value = false;
      }, 1600);
    });
  }

  signOut() {
    inject(EDIT_MODE).off();
    void inject(AUTH_SESSION)
      .logout()
      .then(() => navigate('/projects'));
  }

  get isSignedIn() {
    return inject(AUTH_SESSION).isAuthenticated;
  }
}

await defineComponent({
  tag: 'shell-layout',
  element: ShellLayout,
  module: import.meta.url,
  uses: [LinksEditor, ProfileCard],
});
