import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { group } from '@core/forms/group.js';
import { email, maxLength, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { AvatarCropper } from './avatar-cropper.js';
import { CONTENT } from '../services/content-service.js';

/** @import { Profile } from '../services/types.js' */

export class ProfileForm extends EditorElement {
  cropping = signal(false);

  /** @type {Profile | null} */
  #built = null;

  form = buildForm(null);

  onMount() {
    // The profile arrives with the rail's one request, which may land after this
    // form is on screen; `willUpdate` is where it gets picked up.
    this.#adopt();
  }

  /** @param {Map<PropertyKey, unknown>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    this.#adopt();
  }

  get profile() {
    return inject(CONTENT).profile;
  }

  get avatarUrl() {
    return this.form.fields.avatarUrl.value.value;
  }

  openCropper() {
    this.cropping.value = true;
  }

  closeCropper() {
    this.cropping.value = false;
  }

  /** @param {Event} event */
  cropped(event) {
    const url = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';
    if (url !== '') this.form.fields.avatarUrl.setValue(url);
    this.cropping.value = false;
  }

  clearAvatar() {
    this.form.fields.avatarUrl.setValue('');
  }

  save() {
    const values = this.form.values;
    /** @type {Partial<Profile>} */
    const patch = {
      name: values.name.trim(),
      headline: values.headline.trim(),
      bio: values.bio,
      current: values.current.trim(),
      now: values.now.trim(),
      available: values.available.trim(),
      location: values.location.trim(),
      email: values.email.trim(),
      avatarUrl: values.avatarUrl,
    };
    this.commit(this.form, () => inject(CONTENT).saveProfile(patch));
  }

  /** Rebuild once the record this form is for has actually arrived. */
  #adopt() {
    const profile = this.profile.value;
    if (profile === this.#built) return;
    this.#built = profile;
    this.form = buildForm(profile);
  }
}

/** @param {Profile | null} record */
function buildForm(record) {
  return group({
    name: field(record?.name ?? '', [required(), maxLength(128)]),
    headline: field(record?.headline ?? '', [maxLength(255)]),
    bio: field(record?.bio ?? ''),
    current: field(record?.current ?? '', [maxLength(255)]),
    now: field(record?.now ?? '', [maxLength(255)]),
    available: field(record?.available ?? '', [maxLength(128)]),
    location: field(record?.location ?? '', [maxLength(128)]),
    email: field(record?.email ?? '', [email(), maxLength(255)]),
    avatarUrl: field(record?.avatarUrl ?? '', [maxLength(512)]),
  });
}

await defineComponent({
  tag: 'profile-form',
  element: ProfileForm,
  module: import.meta.url,
  uses: [UiField, AvatarCropper],
});
