import { registerTemplateGlobals } from '@core/template/expression.js';

import { brandPath, iconPath, isBrand } from './icons.js';

// Re-exported because `srl check templates` types a template global as the export
// of the module that registers it: `isBrandIcon` is `isBrand`, so this module has
// to offer the name it hands over.
export { isBrand };

/**
 * Icons, by bare name in every template. The alternative is an `icon()` method on
 * every component that draws one, which was already four copies of the same three
 * lines.
 *
 * @param {string} name
 * @returns {string}
 */
export function icon(name) {
  if (isBrand(name)) return brandPath(name);
  const path = iconPath(name);
  return path === '' ? iconPath('link') : path;
}

/**
 * Every name this site's templates may use without declaring it, in the one place
 * that knows them.
 *
 * A function rather than two lines in main.js, because main.js is not importable:
 * it starts the application at the top level, so anything that renders one of
 * these templates outside a running application — a suite, most of all — would
 * have had to list the pair again, and a list nobody checks is a list that drifts
 * from the templates it feeds.
 */
export function registerAppTemplateGlobals() {
  registerTemplateGlobals({ icon, isBrandIcon: isBrand });
}
