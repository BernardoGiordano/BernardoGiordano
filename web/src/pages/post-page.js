import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { effect, signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
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
  /** @type {import('@preact/signals-core').Signal<Post | null>} */
  post = signal(null);

  isLoading = signal(true);
  missing = signal(false);
  editing = signal(false);
  busy = signal(false);
  errorKey = signal('');

  /** The route is /blog/:slug, so a parameter change is not a remount. */
  #slug = '';

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

    this.isLoading.value = true;
    this.missing.value = false;
    this.editing.value = false;

    void inject(BLOG)
      .post(slug)
      .then((post) => {
        this.post.value = post;
        // After the fetch rather than beside it: a slug that 404s is a typed
        // URL, and counting it would put a row in the table for a post that
        // does not exist. A draft is not counted either — the backend refuses
        // one, because the only reader who can open it is its author.
        inject(VISITS).record('post', post.slug);
      })
      .catch(() => {
        this.missing.value = true;
      })
      .finally(() => {
        this.isLoading.value = false;
      });
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
    this.post.value = post;
    if (post.slug === this.#slug) return;
    this.#slug = post.slug;
    navigate(`/blog/${post.slug}`);
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
