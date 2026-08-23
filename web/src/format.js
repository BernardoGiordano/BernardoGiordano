import { locale, t } from '@core/localization/i18n.js';

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function relativeTime(iso) {
  if (iso === null || iso === undefined || iso === '') return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return t('time.today');
  if (days < 30) return t('time.days', { count: days });

  const months = Math.floor(days / 30.44);
  if (months < 12) return t('time.months', { count: months });

  return t('time.years', { count: Math.floor(days / 365.25) });
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function monthAndYear(iso) {
  if (iso === null || iso === undefined || iso === '') return '';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' });
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function fullDate(iso) {
  if (iso === null || iso === undefined || iso === '') return '';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString(locale.value, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The index's date, in the margin beside a title. The month is abbreviated
 * because that column is 104px wide and "28 September 2024" is two lines in it,
 * where the post's own byline has the whole measure and spells it out.
 *
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function shortDate(iso) {
  if (iso === null || iso === undefined || iso === '') return '';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Compact counts, because "3.3M downloads" is the fact and "3,312,884" is trivia.
 *
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function compactNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/**
 * Hosts where the account name is a subdomain rather than a path.
 */
const VANITY_SUBDOMAIN = /^([\w-]+)\.(bandcamp\.com|tumblr\.com|substack\.com|itch\.io)$/u;

/** Hosts whose handles are written with a leading @. */
const AT_HOSTS = new Set(['instagram.com', 'threads.net', 'x.com', 'twitter.com', 'tiktok.com']);

/** Hosts whose handles are written bare. */
const BARE_HOSTS = new Set(['soundcloud.com', 'medium.com', 'dev.to']);

/** Hosts where the first path segment is a section and the handle is the pair. */
const SECTIONED_HOSTS = new Set(['linkedin.com', 'github.com', 'gitlab.com', 'codeberg.org']);

/**
 * The handle a link points at — `in/bernardogiordano`, `@bernardogiordano`,
 * `kintsukuroi` — or '' when the address does not name one.
 *
 * The rail used to list the networks themselves, which is five rows saying what
 * the icon beside each of them already said. The account name is the part a
 * reader has any use for, and it is in the URL for most of them, so it does not
 * need a column in the database to be shown.
 *
 * '' rather than a guess when the address is a numeric id or a search page:
 * every caller falls back to the link's own label, which is what a hand-written
 * name is for.
 *
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function socialHandle(url) {
  if (url === null || url === undefined || url === '') return '';

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  const host = parsed.hostname.replace(/^www\./u, '').toLowerCase();
  const parts = parsed.pathname.split('/').filter((part) => part !== '');

  const vanity = VANITY_SUBDOMAIN.exec(host);
  if (vanity !== null) return vanity[1];

  if (parts.length === 0) return '';

  const first = parts[0] ?? '';

  if (SECTIONED_HOSTS.has(host)) {
    // github.com/owner and github.com/owner/repo are both handles; a deeper
    // path is a file in a tree and is not.
    if (host === 'linkedin.com') return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    return parts.length > 2 ? '' : parts.join('/');
  }

  if (AT_HOSTS.has(host)) return parts.length === 1 ? `@${first.replace(/^@/u, '')}` : '';

  if (BARE_HOSTS.has(host)) return parts.length === 1 ? first : '';

  if (host === 'youtube.com') return first.startsWith('@') ? first : '';

  if (host === 'bsky.app') return parts[0] === 'profile' && parts[1] !== undefined ? `@${parts[1]}` : '';

  // goodreads.com/author/show/21543692.Bernardo_Giordano — the id is theirs and
  // the name after the dot is the one worth reading.
  if (host === 'goodreads.com') {
    const slug = /^\d+\.(.+)$/u.exec(parts.at(-1) ?? '');
    return slug === null ? '' : slug[1].replaceAll('_', ' ');
  }

  // Last, and only for hosts named nowhere above: Mastodon and the rest of the
  // fediverse write /@user, and the instance is half of the address so it
  // stays. Checked here rather than first because youtube.com/@channel is the
  // same shape and is not a fediverse address.
  if (parts.length === 1 && first.startsWith('@')) return `${first}@${host}`;

  return '';
}
