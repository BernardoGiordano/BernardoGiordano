import { SignalElement, defineComponent } from '@srljs/core';

export class NotFoundPage extends SignalElement {}

await defineComponent({ tag: 'not-found-page', element: NotFoundPage, module: import.meta.url });
