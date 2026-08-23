import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { navigate } from '@core/navigation/router.js';
import { t } from '@core/localization/i18n.js';
import { AUTH_SESSION } from '@auth/session.js';

export class LoginPage extends SignalElement {
  errorKey = signal('');
  busy = signal(false);

  /** @param {SubmitEvent} event */
  submit(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const data = new FormData(form);
    const username = data.get('username');
    const password = data.get('password');

    this.busy.value = true;
    this.errorKey.value = '';

    void inject(AUTH_SESSION)
      .login({
        username: typeof username === 'string' ? username : '',
        password: typeof password === 'string' ? password : '',
      })
      .then(() => navigate('/projects'))
      .catch(() => {
        this.errorKey.value = 'login.failed';
      })
      .finally(() => {
        this.busy.value = false;
      });
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }
}

await defineComponent({ tag: 'login-page', element: LoginPage, module: import.meta.url });
