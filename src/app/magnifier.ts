// Tools ▸ Show Magnifier: a loupe that follows the pointer over the page area.
// It is transient chrome state (never saved), so it starts hidden on every
// launch. The loupe redraws the page bitmaps under the pointer at a fixed
// multiple of the current scale and wears the Document's reading filter, so
// filtered content is magnified as the reader sees it. It is suppressed outside
// the page area and in Slideshow.

/** How many times the current scale the loupe magnifies. */
export const MAGNIFIER_ZOOM = 2;
/** The loupe's diameter in CSS pixels. */
const LOUPE_SIZE = 180;
const READING_FILTER_PROPERTY = '--monight-reading-filter';

export interface Magnifier {
  visible(): boolean;
  /** Shows or hides the loupe, as Tools ▸ Show Magnifier does. */
  toggle(): void;
  hide(): void;
  /** Hides the loupe at once if Slideshow has started, without waiting for the pointer. */
  refresh(): void;
  /** Calls back whenever visibility changes; returns the unsubscribe. */
  observe(listener: (visible: boolean) => void): () => void;
  destroy(): void;
}

export interface MagnifierOptions {
  /** The page area the loupe works over. */
  readonly host: HTMLElement;
  readonly isSlideshow: () => boolean;
}

type PageBitmap = HTMLCanvasElement | HTMLImageElement;

function bitmapSize(bitmap: PageBitmap): { width: number; height: number } {
  return bitmap instanceof HTMLCanvasElement
    ? { width: bitmap.width, height: bitmap.height }
    : { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
}

/** The reading filter the viewer sets inline on an ancestor of the page. */
function readingFilterAt(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = (node as HTMLElement).style?.getPropertyValue(READING_FILTER_PROPERTY).trim();
    if (value) return value;
  }
  return 'none';
}

export function createMagnifier({ host, isSlideshow }: MagnifierOptions): Magnifier {
  const loupe = document.createElement('div');
  loupe.className = 'magnifier';
  loupe.hidden = true;
  loupe.setAttribute('aria-hidden', 'true');
  const view = document.createElement('canvas');
  loupe.append(view);
  document.body.append(loupe);

  const listeners = new Set<(visible: boolean) => void>();
  let visible = false;

  const hideLoupe = () => {
    loupe.hidden = true;
  };

  const draw = (clientX: number, clientY: number) => {
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.round(LOUPE_SIZE * ratio);
    if (view.width !== pixels) {
      view.width = pixels;
      view.height = pixels;
    }
    const context = view.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, pixels, pixels);
    const reach = LOUPE_SIZE / MAGNIFIER_ZOOM / 2;
    const left = clientX - reach;
    const top = clientY - reach;
    const bitmaps = host.querySelectorAll<PageBitmap>(
      '.embedpdf-document-surface[data-visible="true"] canvas, .embedpdf-document-surface[data-visible="true"] img',
    );
    for (const bitmap of bitmaps) {
      const rect = bitmap.getBoundingClientRect();
      const { width, height } = bitmapSize(bitmap);
      if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) continue;
      const x0 = Math.max(left, rect.left);
      const y0 = Math.max(top, rect.top);
      const x1 = Math.min(left + reach * 2, rect.right);
      const y1 = Math.min(top + reach * 2, rect.bottom);
      if (x1 <= x0 || y1 <= y0) continue;
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const toLoupe = MAGNIFIER_ZOOM * ratio;
      context.drawImage(
        bitmap,
        (x0 - rect.left) * scaleX,
        (y0 - rect.top) * scaleY,
        (x1 - x0) * scaleX,
        (y1 - y0) * scaleY,
        (x0 - left) * toLoupe,
        (y0 - top) * toLoupe,
        (x1 - x0) * toLoupe,
        (y1 - y0) * toLoupe,
      );
    }
  };

  /** Whether the pointer is over a page: its bitmap, or an overlay on top of one. */
  const overPage = (event: PointerEvent | MouseEvent): boolean => {
    if (event.target instanceof HTMLCanvasElement || event.target instanceof HTMLImageElement) {
      return true;
    }
    const bitmaps = host.querySelectorAll<PageBitmap>(
      '.embedpdf-document-surface[data-visible="true"] canvas, .embedpdf-document-surface[data-visible="true"] img',
    );
    return [...bitmaps].some((bitmap) => {
      const rect = bitmap.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });
  };

  const onPointerMove = (event: PointerEvent | MouseEvent) => {
    if (!visible || isSlideshow()) {
      hideLoupe();
      return;
    }
    if (!overPage(event)) {
      hideLoupe();
      return;
    }
    if (event.target instanceof Element) {
      view.style.filter = readingFilterAt(event.target);
    }
    loupe.style.left = `${event.clientX - LOUPE_SIZE / 2}px`;
    loupe.style.top = `${event.clientY - LOUPE_SIZE / 2}px`;
    draw(event.clientX, event.clientY);
    loupe.hidden = false;
  };

  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerleave', hideLoupe);

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    if (!next) hideLoupe();
    for (const listener of [...listeners]) listener(next);
  };

  return {
    visible: () => visible,
    toggle: () => setVisible(!visible),
    hide: () => setVisible(false),
    refresh() {
      if (isSlideshow()) hideLoupe();
    },
    observe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', hideLoupe);
      loupe.remove();
      listeners.clear();
    },
  };
}
