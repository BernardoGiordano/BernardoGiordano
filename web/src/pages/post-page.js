import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { effect, signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { resource } from '@core/foundation/resource.js';
import { navigate, routeParams } from '@core/navigation/router.js';
import { t } from '@core/localization/i18n.js';

import { BLOG } from '../services/blog-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { VISITS } from '../services/visits-service.js';
import { PostEditor } from '../components/post-editor.js';
import { RowTools } from '../components/row-tools.js';
import { fullDate } from '../format.js';
import { failureKey } from '../forms.js';
// Imported for the side effect, and absent from `uses` below: md-body owns its
// own children so it cannot be a srl component, whose template would wipe them
// on every render. It declares `static observedAttributes`, which is what the
// template checker reads for an element that is not one.
import '../components/md-body.js';

/** @import { Post } from '../services/types.js' */

export class PostPage extends SignalElement {
  /**
   * The post at this URL, and the three things the template used to keep by hand.
   * /blog/a to /blog/b is a parameter change rather than a remount, so two reads
   * can be in the air at once and the slower one used to land last: this page
   * showed a post the URL did not name. The resource aborts the read it replaces,
   * drops a response that arrives for an aborted one, and binds the request to
   * this element's lifetime, so `onDestroy` has nothing to write.
   *
   * `pending` starts true, which is what the first paint needs: it happens before
   * `onMount`, and a page that says nothing there reads as a post with no title.
   */
  #post = resource((signal) => inject(BLOG).post(this.#slug, signal), {
    initial: /** @type {Post | null} */ (null),
    lifetime: () => this.lifetime,
  });

  editing = signal(false);
  busy = signal(false);
  errorKey = signal('');

  /** The route is /blog/:slug, so a parameter change is not a remount. */
  #slug = '';

  get post() {
    return this.#post.value;
  }

  get isLoading() {
    return this.#post.pending;
  }

  /** A slug nothing answers for. The read rejected and nothing superseded it. */
  get missing() {
    return this.#post.failed;
  }

  /**
   * An effect rather than a lifecycle hook: /blog/a to /blog/b re-renders this
   * element instead of remounting it, and nothing in the template reads
   * `routeParams`, so without a subscription of its own the page would go on
   * showing the previous post.
   */
  onMount() {
    const stop = effect(() => {
      this.#fetch(routeParams.value.slug ?? '');
    });
    this.lifetime.addEventListener('abort', stop);
  }

  /** @param {string} slug */
  #fetch(slug) {
    if (slug === '' || slug === this.#slug) return;
    this.#slug = slug;
    this.editing.value = false;
    void this.#read();
  }

  /**
   * `reload()` answers with the post only for the read that was neither
   * superseded nor rejected, which is the one whose view is on screen.
   */
  async #read() {
    const post = await this.#post.reload();
    // After the fetch rather than beside it: a slug that 404s is a typed URL, and
    // counting it would put a row in the table for a post that does not exist. A
    // draft is not counted either — the backend refuses one, because the only
    // reader who can open it is its author.
    if (post !== null && post !== undefined) inject(VISITS).record('post', post.slug);
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /** @param {string} iso */
  date(iso) {
    return fullDate(iso);
  }

  open() {
    this.errorKey.value = '';
    this.editing.value = true;
  }

  close() {
    this.editing.value = false;
  }

  /**
   * The slug may have changed under the editor, in which case this URL no longer
   * names the post and the browser has to be told.
   *
   * @param {Event} event
   */
  saved(event) {
    const detail = event instanceof CustomEvent ? event.detail : null;
    const post = /** @type {Post | null} */ (detail);
    this.editing.value = false;
    if (post === null) return;

    // The service cached the saved record under its new slug, so this read is a
    // map lookup rather than a request — and going through the resource is what
    // keeps the page's one copy of the post in one place.
    const moved = post.slug !== this.#slug;
    this.#slug = post.slug;
    void this.#post.reload();
    if (moved) navigate(`/blog/${post.slug}`);
  }

  discard() {
    const post = this.post.value;
    if (post === null) return;
    this.busy.value = true;
    this.errorKey.value = '';
    void inject(BLOG)
      .remove(post.id, post.slug)
      .then(() => navigate('/blog'))
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busy.value = false;
      });
  }

  /** The route's `canDeactivate` asks this before it lets the editor go. */
  mayLeave() {
    const editor = this.querySelector('post-editor');
    if (!(editor instanceof PostEditor) || !editor.isDirty) return true;
    return confirm(t('editor.unsaved'));
  }
}

await defineComponent({
  tag: 'post-page',
  element: PostPage,
  module: import.meta.url,
  uses: [PostEditor, RowTools],
});
