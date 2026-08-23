import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';
import { resolvedTheme } from '@core/appearance/theme.js';
import { bypassSecurityTrustResourceUrl } from '@core/template/security.js';

import { ART } from '../services/art-service.js';
import { EDIT_MODE } from '../services/edit-mode.js';
import { ArtEditor } from '../components/art-editor.js';
import { RowTools } from '../components/row-tools.js';
import { monthAndYear } from '../format.js';
import { failureKey } from '../forms.js';

/** @import { ArtWork } from '../services/types.js' */

const BANDCAMP_ORIGIN = 'https://bandcamp.com';

/**
 * The player's two colours, per theme. Bandcamp paints its own chrome, so a
 * white player on the dark theme is a lit rectangle in the middle of the page
 * unless these follow the palette. Both are `--ui-color-surface` and
 * `--ui-color-primary` for the theme, written out because a query string cannot
 * read a custom property.
 */
const PLAYER_SKIN = {
  light: { background: 'e7eaf7', link: '5d5294' },
  dark: { background: '232532', link: '9184d9' },
};

/**
 * The player's geometry, measured off the rendered player rather than guessed.
 *
 * Bandcamp stretches its track list to fill whatever height the iframe is given
 * and scrolls internally past it, so the player never shrinks to its own
 * content: one fixed height is right for one record and wrong for every other.
 * The old 460px was right for none of them — an eight-track record left a band
 * of Bandcamp's own white under the last row, and a thirteen-track one put a
 * scrollbar inside a page that already scrolls.
 *
 * `header` is the title, the credit line and the transport, which is the whole
 * player when there is no track list. `chrome` is that same band plus the
 * list's rules and its scroll gutter, and `row` is one track. 132 + 33n lands
 * within a pixel of the last row's rule from one track upwards.
 */
const PLAYER_SIZE = { header: 122, chrome: 132, row: 33 };

/** No row has this id, so it is the one that means "the row being added". */
const NEW_ROW = 0;

export class ArtPage extends SignalElement {
  editing = signal(-1);
  busyId = signal(-1);
  errorKey = signal('');

  onMount() {
    if (!inject(ART).loaded.value) void inject(ART).load();
  }

  get rows() {
    return inject(ART).rows;
  }

  get isLoading() {
    return inject(ART).isLoading;
  }

  get canEdit() {
    return inject(EDIT_MODE).isOn;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /**
   * The embed URL, trusted for a resource sink after the album id is checked to
   * be digits and the origin is fixed here rather than taken from the record.
   *
   * `artwork=none` drops Bandcamp's own cover — the one above it is ours, and a
   * second one a few sizes smaller was never doing anything the first didn't.
   *
   * `tracklist=true` is asked for only when the record names its tracks, since
   * that count is the only thing that can size the frame to the list (see
   * `embedHeight`). Without it Bandcamp draws a list stretched to a height
   * nobody measured, which is the empty white box this replaces.
   *
   * `transparent=true` lets the page's own ground show through the player rather
   * than have it paint a rectangle a few values off the surface it sits on;
   * `bgcol` stays as the value it falls back to.
   *
   * The player is on the page rather than behind a button — a record you cannot
   * hear without a click first is a record nobody hears — and `loading="lazy"`
   * in the template is what keeps a page of them from opening every connection
   * at once.
   *
   * @param {ArtWork} work
   */
  embedUrl(work) {
    if (!/^\d+$/u.test(work.bandcampAlbumId)) return '';
    const skin = resolvedTheme.value === 'dark' ? PLAYER_SKIN.dark : PLAYER_SKIN.light;
    const tracklist = this.hasTracklist(work) ? 'tracklist=true/' : '';
    const url = new URL(
      `/EmbeddedPlayer/album=${work.bandcampAlbumId}/size=large/bgcol=${skin.background}/linkcol=${skin.link}/${tracklist}artwork=none/transparent=true/`,
      BANDCAMP_ORIGIN,
    );
    return bypassSecurityTrustResourceUrl(url.href);
  }

  /**
   * Whether the player is asked for its track list. Only a record that names
   * its tracks can be given a frame the right height for one, and a list in a
   * frame of the wrong height is either a white band under the last row or a
   * scrollbar inside the page's own scroll.
   *
   * @param {ArtWork} work
   */
  hasTracklist(work) {
    return work.tracks.length > 0;
  }

  /**
   * The frame's height in pixels: exactly what the player draws, so it ends on
   * the last row's rule. Bound as the iframe's `height` attribute rather than
   * fixed in the stylesheet, which is what let one number stand for every
   * record. Width stays 100% — the frame is still fluid, only its height is
   * told what the content is.
   *
   * @param {ArtWork} work
   */
  embedHeight(work) {
    const tracks = work.tracks.length;
    if (tracks === 0) return PLAYER_SIZE.header;
    return PLAYER_SIZE.chrome + PLAYER_SIZE.row * tracks;
  }

  /**
   * The kicker over the title: what the thing is and when it came out, which is
   * the pair a record shop's divider card carries.
   *
   * @param {ArtWork} work
   */
  kindLine(work) {
    const parts = [work.kind, work.releasedOn === '' ? '' : monthAndYear(work.releasedOn)];
    return parts.filter((part) => part !== '').join(' \u00b7 ');
  }

  /**
   * The line under the title: who made it, who put it out, and the number on the
   * spine. One line rather than a definition list — three facts do not need
   * three rows and a column of labels.
   *
   * @param {ArtWork} work
   */
  creditLine(work) {
    return [work.subtitle, work.label, work.catalogNumber].filter((part) => part !== '').join(' \u00b7 ');
  }

  /** A book stands up; a record is square. @param {ArtWork} work */
  isPortrait(work) {
    return /book|libro|novel/iu.test(work.kind);
  }

  /**
   * The first link is the one to press and the rest are quiet: on a release
   * page every link goes somewhere useful, and two filled buttons side by side
   * say neither is the answer.
   *
   * @param {ArtWork} work
   * @param {{ url: string }} link
   */
  isPrimaryLink(work, link) {
    return work.links[0]?.url === link.url;
  }

  /** @param {ArtWork} work */
  hasEmbed(work) {
    return /^\d+$/u.test(work.bandcampAlbumId);
  }

  /* ── Editing ────────────────────────────────────────────────────────────── */

  get isCreating() {
    return this.editing.value === NEW_ROW;
  }

  /** @param {ArtWork} work */
  isEditing(work) {
    return this.editing.value === work.id;
  }

  /** @param {ArtWork} work */
  isBusy(work) {
    return this.busyId.value === work.id;
  }

  openNew() {
    this.errorKey.value = '';
    this.editing.value = NEW_ROW;
  }

  /** @param {ArtWork} work */
  open(work) {
    this.errorKey.value = '';
    this.editing.value = work.id;
  }

  close() {
    this.editing.value = -1;
  }

  /** @param {ArtWork} work */
  discard(work) {
    this.busyId.value = work.id;
    this.errorKey.value = '';
    void inject(ART)
      .remove(work.id)
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busyId.value = -1;
      });
  }
}

await defineComponent({
  tag: 'art-page',
  element: ArtPage,
  module: import.meta.url,
  uses: [ArtEditor, RowTools],
});
