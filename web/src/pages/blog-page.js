import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { effect, signal } from '@core/foundation/reactive.js';
import { queryParams } from '@core/navigation/router.js';
import { t } from '@core/localization/i18n.js';

import { BLOG } from '../services/blog-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { shortDate } from '../format.js';

/** Thirty tags is five rows of chips, which is why they are at the foot of the
 * page and why only twelve of them show until asked. */
const VISIBLE_TAGS = 12;

export class BlogPage extends SignalElement {
  allTagsShown = signal(false);

  /** The tag the list on screen was loaded for, or `null` before the first one. */
  #loadedTag = /** @type {string | null} */ (null);

  /**
   * An effect rather than a lifecycle hook, for the reason post-page.js gives:
   * /blog and /blog?tag=x are the same route, so clicking a chip re-renders this
   * element instead of remounting it, `onMount` never runs again, and the list
   * went on showing every post while the chip above it said it was filtered.
   * Nothing in the template reads `queryParams`, so the subscription has to be
   * taken here.
   */
  onMount() {
    const stop = effect(() => {
      this.#fetch(queryParams.value.get('tag') ?? '');
    });
    this.lifetime.addEventListener('abort', stop);
  }

  /** @param {string} tag */
  #fetch(tag) {
    if (tag === this.#loadedTag) return;
    this.#loadedTag = tag;
    this.allTagsShown.value = false;
    void inject(BLOG).load({ tag: tag === '' ? undefined : tag });
  }

  /** The tag filter is a query parameter, so a filtered list is a URL. */
  get tag() {
    return queryParams.value.get('tag') ?? undefined;
  }

  get rows() {
    return inject(BLOG).rows;
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get tags() {
    const all = inject(BLOG).tags.value;
    return this.allTagsShown.value ? all : all.slice(0, VISIBLE_TAGS);
  }

  /**
   * Zero once they are all shown, which is what keeps the `+18` chip from
   * standing next to the eighteen tags it was offering to reveal.
   */
  get hiddenTagCount() {
    if (this.allTagsShown.value) return 0;
    return Math.max(0, inject(BLOG).tags.value.length - VISIBLE_TAGS);
  }

  get canCollapseTags() {
    return this.allTagsShown.value && inject(BLOG).tags.value.length > VISIBLE_TAGS;
  }

  toggleTags() {
    this.allTagsShown.value = !this.allTagsShown.value;
  }

  get total() {
    return inject(BLOG).total;
  }

  get isLoading() {
    return inject(BLOG).isLoading;
  }

  get hasMore() {
    return this.rows.value.length < this.total.value;
  }

  /** @param {string} iso */
  date(iso) {
    return shortDate(iso);
  }

  /**
   * What an entry says about itself under its summary: how long it takes to
   * read, and how many people have opened it. Joined here rather than as two
   * spans in the template because the middot between them belongs to neither —
   * a post nobody has opened yet would otherwise render a separator with
   * nothing after it, exactly as the tab bar's totals used to.
   *
   * @param {import('../services/types.js').PostSummary} post
   */
  meta(post) {
    const parts = [];
    if (post.readingMinutes) parts.push(t('blog.readingTime', { count: post.readingMinutes }));
    if (post.views) parts.push(t('blog.views', { count: post.views }));
    return parts.join(' \u00b7 ');
  }

  /** @param {string} name */
  tagHref(name) {
    return name === '' ? '/blog' : `/blog?tag=${encodeURIComponent(name)}`;
  }

  /** @param {string} name */
  tagClasses(name) {
    return (this.tag ?? '') === name ? 'chip chip-on' : 'chip';
  }

  loadMore() {
    void inject(BLOG).load({ tag: this.tag, offset: this.rows.value.length, append: true });
  }

  /** The count the list is a page of, so "12 of 46" is sayable. */
  get shown() {
    return this.rows.value.length;
  }
}

await defineComponent({ tag: 'blog-page', element: BlogPage, module: import.meta.url });
