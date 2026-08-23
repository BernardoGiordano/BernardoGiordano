import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { attachRouter } from '@core/navigation/router.js';

import { createRoutes } from './routes.js';

export class AppRoot extends SignalElement {
  onMount() {
    void attachRouter(this, createRoutes());
  }
}

await defineComponent({ tag: 'app-root', element: AppRoot, module: import.meta.url });
