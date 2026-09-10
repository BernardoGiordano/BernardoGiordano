import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { attachRouter } from '@core/navigation/router.js';
import { releaseChanged, watchRelease } from '@core/application/release.js';

import { createRoutes } from './routes.js';

export class AppRoot extends SignalElement {
  /**
   * True once the origin serves a different build than this tab loaded. It never
   * goes back to false: the tab cannot become less stale by being asked again.
   */
  updated = releaseChanged;

  /** @type {(() => void) | undefined} */
  #stopWatching;

  onMount() {
    void attachRouter(this, createRoutes());

    /* A deploy lands, this tab keeps the chunk hashes it booted with, and the
       failure it eventually shows is a route that will not load. The read rides
       the navigations the visitor is already making — at a commit boundary, at
       most once a minute — so the answer arrives at the one moment they can act
       on it. */
    this.#stopWatching = watchRelease();
  }

  onDestroy() {
    this.#stopWatching?.();
  }

  reload() {
    globalThis.location.reload();
  }
}

await defineComponent({ tag: 'app-root', element: AppRoot, module: import.meta.url });
