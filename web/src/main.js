import { inject, provide } from '@core/foundation/inject.js';
import { configureTheme } from '@core/appearance/theme.js';
import { API_CLIENT, ApiClient } from '@core/http/client.js';
import { AUTH_SESSION, AuthSession } from '@auth/session.js';
import { sessionFetch } from '@auth/session-fetch.js';
import { startApplication } from '@core/application/runtime.js';

import { BffCookieTokenStore } from './auth/bff-cookie-store.js';
import { registerAppTemplateGlobals } from './template-globals.js';
import { ART, ArtService } from './services/art-service.js';
import { BLOG, BlogService } from './services/blog-service.js';
import { CONTENT, ContentService } from './services/content-service.js';
import { CV, CvService } from './services/cv-service.js';
import { EDIT_MODE, EditMode } from './services/edit-mode.js';
import { MEDIA, MediaService } from './services/media-service.js';
import { PROJECTS, ProjectsService } from './services/projects-service.js';
import { VISITS, VisitsService } from './services/visits-service.js';

/**
 * FastAPI answers `{ "detail": "slug_taken" }`, where `ApiClient` reads
 * `{ "error": ... }` by default. Mapped once here so a screen can branch on
 * `error.code` rather than on the status alone.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
function fastApiCode(status, body) {
  const detail = typeof body === 'object' && body !== null ? /** @type {{ detail?: unknown }} */ (body).detail : undefined;
  return typeof detail === 'string' ? detail : `http_${String(status)}`;
}

await startApplication({
  configure: () => {
    configureTheme({ defaultTheme: 'system' });
    registerAppTemplateGlobals();
  },

  providers: (manifest) => {
    provide(AUTH_SESSION, () => new AuthSession(new BffCookieTokenStore('/auth')));
    provide(API_CLIENT, () => new ApiClient(manifest.auth.apiBaseUrl, { fetch: sessionFetch, errorCode: fastApiCode }));

    provide(CONTENT, () => new ContentService(inject(API_CLIENT)));
    provide(PROJECTS, () => new ProjectsService(inject(API_CLIENT)));
    provide(ART, () => new ArtService(inject(API_CLIENT)));
    provide(CV, () => new CvService(inject(API_CLIENT)));
    provide(BLOG, () => new BlogService(inject(API_CLIENT)));
    provide(VISITS, () => new VisitsService(inject(API_CLIENT)));
    provide(MEDIA, () => new MediaService(inject(AUTH_SESSION)));
    provide(EDIT_MODE, () => new EditMode(inject(AUTH_SESSION)));
  },

  /* Before the first route resolves, so a reload on /blog/<slug> does not paint
     the signed-out rail and then swap in the edit controls. */
  ready: () => inject(AUTH_SESSION).init(),

  root: { load: () => import('./app-root.js').then((m) => m.AppRoot) },
});
