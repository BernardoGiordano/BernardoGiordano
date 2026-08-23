import { inject } from '@core/foundation/inject.js';
import { guard } from '@core/navigation/router.js';
import { AUTH_SESSION } from '@auth/session.js';

import { LoginPage } from './pages/login-page.js';
import { NotFoundPage } from './pages/not-found-page.js';

/** @import { RouteDef } from '@core/navigation/types.js' */

/**
 * Four tabs are four routes, so every one of them is a URL somebody can send.
 * The shell is a layout route: the left rail and the tab bar outlive every
 * navigation inside it, and only /login renders without them.
 *
 * @returns {RouteDef[]}
 */
export function createRoutes() {
  return [
    { path: '/login', component: LoginPage },

    {
      path: '',
      load: () => import('./pages/shell-layout.js').then((m) => m.ShellLayout),
      children: [
        { path: '', redirect: '/projects' },
        { path: 'projects', load: () => import('./pages/projects-page.js').then((m) => m.ProjectsPage) },
        { path: 'art', load: () => import('./pages/art-page.js').then((m) => m.ArtPage) },
        { path: 'cv', load: () => import('./pages/cv-page.js').then((m) => m.CvPage) },
        { path: 'blog', load: () => import('./pages/blog-page.js').then((m) => m.BlogPage) },
        // Before `blog/:slug`, which would otherwise match it and look for a post
        // called "new". First match wins, and the order here is that order.
        {
          // The only route with an entry guard. Not access control — the write it
          // would attempt is refused by api/ either way — but a signed-out
          // visitor typing this address gets an editor whose save can only fail,
          // and the list is the honest answer instead.
          path: 'blog/new',
          load: () => import('./pages/new-post-page.js').then((m) => m.NewPostPage),
          canActivate: guard(() => inject(AUTH_SESSION).isAuthenticated.value, '/blog'),
          canDeactivate: ({ element }) => mayLeave(element),
        },
        {
          path: 'blog/:slug',
          load: () => import('./pages/post-page.js').then((m) => m.PostPage),
          canDeactivate: ({ element }) => mayLeave(element),
        },
        { path: '*', component: NotFoundPage },
      ],
    },
  ];
}

/**
 * A page with an open editor gets asked whether it may go. Duck-typed rather
 * than imported: the guard is installed here, and importing the two page modules
 * to name a method would load both of them at startup — which is the whole point
 * of `load` being lazy.
 *
 * @param {HTMLElement | null} element
 * @returns {boolean}
 */
function mayLeave(element) {
  if (element === null) return true;
  const page = /** @type {{ mayLeave?: () => boolean }} */ (/** @type {unknown} */ (element));
  return typeof page.mayLeave === 'function' ? page.mayLeave() : true;
}
