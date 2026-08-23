import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { navigate } from '@core/navigation/router.js';
import { t } from '@core/localization/i18n.js';

import { PostEditor } from '../components/post-editor.js';

/** A post being written has a URL of its own, so a reload does not lose the tab. */
export class NewPostPage extends SignalElement {
  /** @param {Event} event */
  saved(event) {
    const detail = event instanceof CustomEvent ? event.detail : null;
    const slug = typeof detail?.slug === 'string' ? detail.slug : '';
    navigate(slug === '' ? '/blog' : `/blog/${slug}`);
  }

  cancel() {
    navigate('/blog');
  }

  /** The route's `canDeactivate` asks this before it lets the editor go. */
  mayLeave() {
    const editor = this.querySelector('post-editor');
    if (!(editor instanceof PostEditor) || !editor.isDirty) return true;
    return confirm(t('editor.unsaved'));
  }
}

await defineComponent({
  tag: 'new-post-page',
  element: NewPostPage,
  module: import.meta.url,
  uses: [PostEditor],
});
