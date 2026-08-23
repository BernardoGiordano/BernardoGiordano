import { nothing } from 'lit';
import { ApiError } from '@core/http/client.js';

/**
 * A comma-separated line, as a list. What the editors use for the short list
 * columns — platforms, tech, formats, tags: a combobox per row is a panel, chips
 * and a filter over five values somebody types once.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function textToList(text) {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * @param {readonly string[] | undefined} list
 * @returns {string}
 */
export function listToText(list) {
  return (list ?? []).join(', ');
}

/**
 * The message key for a write that failed, so a form says which failure it was.
 * Only the codes a form can do something about are named; everything else is one
 * sentence, because "409 slug_taken" is actionable and "500" is not.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function failureKey(error) {
  if (!(error instanceof ApiError)) return 'editor.saveFailed';
  if (error.code === 'slug_taken') return 'editor.slugTaken';
  if (error.status === 401 || error.status === 403) return 'editor.signedOut';
  if (error.status === 413) return 'editor.tooLarge';
  if (error.status === 415) return 'editor.notAnImage';
  if (error.status === 422) return 'editor.refused';
  return 'editor.saveFailed';
}

/** @returns {string} Today as `YYYY-MM-DD`, which is what a `date` input holds. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A date the API returned, as a `date` input's value. The API sends a plain date
 * for these columns already; this exists for the datetime case and for null.
 *
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function dateInputValue(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

/**
 * A title, as a slug. Only a suggestion — the field stays editable, and the
 * server has the last word on whether it is free.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 200);
}

/**
 * Move `id` one place in `ids` and return the new order, or the same array when
 * it cannot move. Every reorder control on the site is this function plus a
 * request.
 *
 * @param {readonly number[]} ids
 * @param {number} id
 * @param {-1 | 1} delta
 * @returns {readonly number[]}
 */
export function moved(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * An attribute that disappears when it has nothing to say. `aria-describedby=""`
 * points at an element whose id is the empty string, which is not the same as
 * pointing at nothing.
 *
 * @param {string} value
 * @returns {string | typeof nothing}
 */
export function attr(value) {
  return value === '' ? nothing : value;
}
