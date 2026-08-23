import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';
import { UiDialog } from '@components/overlays/ui-dialog.js';

import { MEDIA } from '../services/media-service.js';
import { failureKey } from '../forms.js';

/** The square the picture is cropped to, in CSS pixels. */
const FRAME = 264;

/** What gets uploaded. The backend re-encodes from here down to its widths. */
const OUTPUT = 512;

const MAX_ZOOM = 4;

/**
 * Pick a picture, move and scale it inside a square, upload the square.
 *
 * A canvas rather than a transformed `<img>`: the crop has to be applied to
 * pixels in the end, and doing it in one place means what the user positions and
 * what gets uploaded cannot disagree. The upload is the cropped square only —
 * the original never leaves the browser, so nothing on the server has to know
 * how to forget it.
 */
export class AvatarCropper extends SignalElement {
  static properties = {
    open: { type: Boolean },
  };

  open = false;

  busy = signal(false);
  errorKey = signal('');

  /** Redraw depends on these, and a signal is how the template hears about them. */
  zoom = signal(1);
  loaded = signal(false);

  /** @type {ImageBitmap | null} */
  #bitmap = null;

  /** Scale at zoom 1: the image just covering the frame. */
  #baseScale = 1;

  /** Top-left of the drawn image, in frame coordinates. */
  #offset = { x: 0, y: 0 };

  /** @type {{ x: number, y: number } | null} */
  #grabbedAt = null;

  get frame() {
    return FRAME;
  }

  get maxZoom() {
    return MAX_ZOOM;
  }

  get hasImage() {
    return this.loaded.value;
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  get applyLabel() {
    return this.busy.value ? t('editor.uploading') : t('editor.apply');
  }

  /** @param {Map<PropertyKey, unknown>} changed */
  updated(changed) {
    super.updated(changed);
    // The canvas is a fresh element every time the dialog opens, so the drawing
    // belongs to the render rather than to the interaction that caused it.
    this.#draw();
  }

  onDestroy() {
    this.#bitmap?.close();
    this.#bitmap = null;
  }

  choose() {
    this.#input?.click();
  }

  /** @param {Event} event */
  pick(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;

    this.errorKey.value = '';
    void createImageBitmap(file)
      .then((bitmap) => {
        this.#bitmap?.close();
        this.#bitmap = bitmap;
        this.#baseScale = Math.max(FRAME / bitmap.width, FRAME / bitmap.height);
        this.zoom.value = 1;
        this.#centre();
        this.loaded.value = true;
        this.#draw();
      })
      .catch(() => {
        this.errorKey.value = 'editor.notAnImage';
      });
  }

  /** @param {Event} event */
  setZoom(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const next = Number(input.value);
    const previous = this.zoom.value;
    if (!Number.isFinite(next) || next <= 0) return;

    // Zoom about the middle of the frame, so the face somebody centred stays
    // centred instead of drifting towards the top-left corner.
    const middle = FRAME / 2;
    const ratio = next / previous;
    this.#offset = {
      x: middle - (middle - this.#offset.x) * ratio,
      y: middle - (middle - this.#offset.y) * ratio,
    };
    this.zoom.value = next;
    this.#clamp();
    this.#draw();
  }

  /** @param {PointerEvent} event */
  grab(event) {
    if (!this.loaded.value) return;
    const target = event.currentTarget;
    if (target instanceof HTMLCanvasElement) target.setPointerCapture(event.pointerId);
    this.#grabbedAt = { x: event.clientX - this.#offset.x, y: event.clientY - this.#offset.y };
  }

  /** @param {PointerEvent} event */
  drag(event) {
    if (this.#grabbedAt === null) return;
    event.preventDefault();
    this.#offset = { x: event.clientX - this.#grabbedAt.x, y: event.clientY - this.#grabbedAt.y };
    this.#clamp();
    this.#draw();
  }

  release() {
    this.#grabbedAt = null;
  }

  dismiss() {
    this.#reset();
    this.dispatchEvent(new CustomEvent('close'));
  }

  /** Crop, encode, upload, and hand the URL to whoever opened this. */
  apply() {
    const bitmap = this.#bitmap;
    if (bitmap === null) return;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const ratio = OUTPUT / FRAME;
    const scale = this.#baseScale * this.zoom.value * ratio;
    context.drawImage(
      bitmap,
      this.#offset.x * ratio,
      this.#offset.y * ratio,
      bitmap.width * scale,
      bitmap.height * scale,
    );

    this.busy.value = true;
    this.errorKey.value = '';
    canvas.toBlob((blob) => {
      if (blob === null) {
        this.busy.value = false;
        this.errorKey.value = 'editor.saveFailed';
        return;
      }
      void inject(MEDIA)
        .upload(blob, { purpose: 'avatar', filename: 'avatar.webp' })
        .then((media) => {
          this.#reset();
          this.dispatchEvent(new CustomEvent('cropped', { detail: media.url }));
        })
        .catch((cause) => {
          this.errorKey.value = failureKey(cause);
        })
        .finally(() => {
          this.busy.value = false;
        });
    }, 'image/webp', 0.92);
  }

  #reset() {
    this.#bitmap?.close();
    this.#bitmap = null;
    this.loaded.value = false;
    this.zoom.value = 1;
    this.errorKey.value = '';
    this.#grabbedAt = null;
  }

  #centre() {
    const bitmap = this.#bitmap;
    if (bitmap === null) return;
    const scale = this.#baseScale * this.zoom.value;
    this.#offset = {
      x: (FRAME - bitmap.width * scale) / 2,
      y: (FRAME - bitmap.height * scale) / 2,
    };
  }

  /** No gaps: the image always covers the square it is being cropped to. */
  #clamp() {
    const bitmap = this.#bitmap;
    if (bitmap === null) return;
    const scale = this.#baseScale * this.zoom.value;
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    this.#offset = {
      x: Math.min(0, Math.max(FRAME - width, this.#offset.x)),
      y: Math.min(0, Math.max(FRAME - height, this.#offset.y)),
    };
  }

  #draw() {
    const canvas = this.#canvas;
    const bitmap = this.#bitmap;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (bitmap === null) return;

    const scale = this.#baseScale * this.zoom.value;
    context.drawImage(bitmap, this.#offset.x, this.#offset.y, bitmap.width * scale, bitmap.height * scale);
  }

  get #canvas() {
    const canvas = this.querySelector('canvas');
    return canvas instanceof HTMLCanvasElement ? canvas : null;
  }

  get #input() {
    const input = this.querySelector('input[type="file"]');
    return input instanceof HTMLInputElement ? input : null;
  }
}

await defineComponent({
  tag: 'avatar-cropper',
  element: AvatarCropper,
  module: import.meta.url,
  uses: [UiDialog],
});
