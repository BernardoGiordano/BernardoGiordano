import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';

import { CONTENT } from '../services/content-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { ProfileForm } from './profile-form.js';

export class ProfileCard extends SignalElement {
  editing = signal(false);

  get profile() {
    return inject(CONTENT).profile;
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get initials() {
    const name = this.profile.value?.name ?? '';
    return name
      .split(/\s+/u)
      .filter((part) => part !== '')
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  open() {
    this.editing.value = true;
  }

  close() {
    this.editing.value = false;
  }
}

await defineComponent({
  tag: 'profile-card',
  element: ProfileCard,
  module: import.meta.url,
  uses: [ProfileForm],
});
