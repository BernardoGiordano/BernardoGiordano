import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';

export class NotFoundPage extends SignalElement {}

await defineComponent({ tag: 'not-found-page', element: NotFoundPage, module: import.meta.url });
