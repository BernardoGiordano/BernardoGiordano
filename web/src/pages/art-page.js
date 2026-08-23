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
   * `tracklist=true` puts the track list back, in Bandcamp's own player rather
   * than a second one drawn here in our type: it already has to render one to
   * seek within, so a copy beside it was one list too many for no player and
   * two lists for this one.
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
    const url = new URL(
      `/EmbeddedPlayer/album=${work.bandcampAlbumId}/size=large/bgcol=${skin.background}/linkcol=${skin.link}/tracklist=true/artwork=none/transparent=true/`,
      BANDCAMP_ORIGIN,
    );
    return bypassSecurityTrustResourceUrl(url.href);
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
