// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarController } from '../app/sidebar-controller';
import type { PdfAnnotation } from '../lib/document-features';
import type { DocumentPresentation } from '../reader/document-access';
import type { DocumentQuery } from '../reader/document-queries';

const annotation = (overrides: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id: 'highlight-1',
  kind: 'highlight',
  pageNumber: 2,
  rects: [],
  text: 'Selected text',
  note: '',
  color: 'yellow',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const mountSidebar = (): void => {
  document.body.innerHTML = `
    <button id="toggle-outline"></button>
    <button id="toggle-thumbnails"></button>
    <button id="toggle-annotations"></button>
    <aside id="document-sidebar" class="hidden">
      <button id="close-sidebar"></button>
      <button id="outline-tab" data-sidebar-tab="outline"></button>
      <button id="thumbnails-tab" data-sidebar-tab="thumbnails"></button>
      <button id="annotations-tab" data-sidebar-tab="annotations"></button>
      <div id="sidebar-content"></div>
    </aside>
  `;
};

function activeDocument(viewer: {
  goToPage?: (pageNumber: number) => Promise<void>;
  getAnnotations?: () => PdfAnnotation[];
  renderThumbnail?: (
    pageNumber: number,
    options?: { rotation?: number },
  ) => Promise<HTMLCanvasElement>;
}) {
  const query = {
    filePath: '/docs/test.pdf',
    generation: 1,
    isCurrent: () => true,
    annotations: () => viewer.getAnnotations?.() ?? [],
    thumbnail: (pageNumber: number, options?: { rotation?: number }) =>
      viewer.renderThumbnail?.(pageNumber, options) ?? Promise.reject(new Error('Unavailable')),
  } as unknown as DocumentQuery;
  return {
    query,
    presentation: {
      ...viewer,
      snapshot: () =>
        'getState' in viewer && typeof viewer.getState === 'function'
          ? viewer.getState()
          : { currentPage: 1, totalPages: 1, rotation: 0 },
    } as unknown as DocumentPresentation,
    navigateToPage: (pageNumber: number) => viewer.goToPage?.(pageNumber) ?? Promise.resolve(),
  };
}

describe('SidebarController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountSidebar();
    Reflect.deleteProperty(window, 'IntersectionObserver');
  });

  it('keeps an Annotation card and its focused note field while a note is saved', () => {
    let annotations = [annotation(), annotation({ id: 'highlight-2', pageNumber: 4 })];
    let controller: SidebarController;
    const viewer = {
      getState: () => ({ currentPage: 2, totalPages: 8, rotation: 0 }),
      getAnnotations: () => annotations.map((item) => ({ ...item })),
      updateAnnotation: vi.fn((id: string, updates: Partial<PdfAnnotation>) => {
        annotations = annotations.map((item) => (item.id === id ? { ...item, ...updates } : item));
        controller.annotationsChanged();
      }),
    };
    const current = activeDocument(viewer);
    controller = new SidebarController({
      getActiveDocument: () => current,
      requestAnnotationNote: vi.fn(),
    });
    controller.open('annotations');

    const card = document.querySelector<HTMLElement>('[data-annotation-id="highlight-1"]');
    const unrelatedCard = document.querySelector<HTMLElement>('[data-annotation-id="highlight-2"]');
    const note = card?.querySelector<HTMLTextAreaElement>('textarea');
    expect(note).not.toBeNull();

    note?.focus();
    for (const character of '  remember this  ') {
      if (!note) break;
      note.value += character;
      note.setSelectionRange(note.value.length, note.value.length);
      note.dispatchEvent(new Event('input', { bubbles: true }));
    }

    expect(viewer.updateAnnotation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(note);
    expect(note?.selectionStart).toBe(17);

    vi.advanceTimersByTime(200);

    expect(viewer.updateAnnotation).toHaveBeenCalledWith('highlight-1', {
      note: 'remember this',
    });
    expect(document.querySelector('[data-annotation-id="highlight-1"]')).toBe(card);
    expect(document.querySelector('[data-annotation-id="highlight-2"]')).toBe(unrelatedCard);
    expect(document.activeElement).toBe(note);
    expect(note?.selectionStart).toBe(17);
  });

  it('reuses rendered thumbnails for the same Document rotation', async () => {
    const state = { currentPage: 1, totalPages: 2, rotation: 0 };
    const renderedCanvases: HTMLCanvasElement[] = [];
    const viewer = {
      getState: () => state,
      renderThumbnail: vi.fn(async () => {
        const canvas = document.createElement('canvas');
        renderedCanvases.push(canvas);
        return canvas;
      }),
    };
    const current = activeDocument(viewer);
    const controller = new SidebarController({
      getActiveDocument: () => current,
      requestAnnotationNote: vi.fn(),
    });

    controller.open('thumbnails');
    await Promise.resolve();
    const firstCanvas = document.querySelector('.thumbnail-preview canvas');
    expect(viewer.renderThumbnail).toHaveBeenCalledTimes(2);
    expect(viewer.renderThumbnail).toHaveBeenNthCalledWith(1, 1, { rotation: 0 });
    expect(viewer.renderThumbnail).toHaveBeenNthCalledWith(2, 2, { rotation: 0 });

    controller.close();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    controller.open('thumbnails');

    expect(viewer.renderThumbnail).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.thumbnail-preview canvas')).toBe(firstCanvas);

    state.rotation = 90;
    Reflect.deleteProperty(window, 'IntersectionObserver');
    controller.presentationStateChanged();
    await Promise.resolve();

    expect(viewer.renderThumbnail).toHaveBeenCalledTimes(4);
    expect(viewer.renderThumbnail).toHaveBeenNthCalledWith(3, 1, { rotation: 90 });
    expect(viewer.renderThumbnail).toHaveBeenNthCalledWith(4, 2, { rotation: 90 });
    expect(document.querySelector('.thumbnail-preview canvas')).not.toBe(firstCanvas);
  });

  it('reconciles Annotation changes without disturbing unrelated cards', () => {
    const first = annotation();
    const second = annotation({ id: 'highlight-2', pageNumber: 4 });
    let annotations = [first, second];
    const state = { currentPage: 2, totalPages: 8, rotation: 0 };
    const viewer = {
      getState: () => state,
      getAnnotations: () => annotations.map((item) => ({ ...item })),
      updateAnnotation: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SidebarController({
      getActiveDocument: () => current,
      requestAnnotationNote: vi.fn(),
    });
    controller.open('annotations');

    const firstCard = document.querySelector<HTMLElement>('[data-annotation-id="highlight-1"]');
    const secondCard = document.querySelector<HTMLElement>('[data-annotation-id="highlight-2"]');
    const secondNote = secondCard?.querySelector<HTMLTextAreaElement>('textarea');
    secondNote?.focus();
    if (secondNote) {
      secondNote.value = ' unfinished draft ';
      secondNote.dispatchEvent(new Event('input', { bubbles: true }));
    }

    firstCard?.querySelector<HTMLSelectElement>('select')?.focus();

    annotations = [
      { ...first, color: 'blue' },
      second,
      annotation({ id: 'highlight-3', pageNumber: 6 }),
    ];
    controller.annotationsChanged();

    expect(document.querySelector('[data-annotation-id="highlight-1"]')).toBe(firstCard);
    expect(firstCard?.dataset.color).toBe('blue');
    expect(document.querySelector('[data-annotation-id="highlight-2"]')).toBe(secondCard);
    expect(secondNote?.value).toBe(' unfinished draft ');

    vi.advanceTimersByTime(200);
    expect(viewer.updateAnnotation).toHaveBeenCalledWith('highlight-2', {
      note: 'unfinished draft',
    });
    secondNote?.focus();

    annotations = [second, annotations[2]];
    controller.annotationsChanged();

    expect(document.querySelector('[data-annotation-id="highlight-1"]')).toBeNull();
    expect(document.querySelector('[data-annotation-id="highlight-2"]')).toBe(secondCard);
    expect(document.activeElement).toBe(secondNote);
    expect(secondNote?.value).toBe(' unfinished draft ');

    state.currentPage = 4;
    const panel = document.querySelector('[data-sidebar-panel="annotations"]');
    controller.presentationStateChanged();

    expect(document.querySelector('[data-sidebar-panel="annotations"]')).toBe(panel);
    expect(secondCard?.classList.contains('active')).toBe(true);
    expect(document.activeElement).toBe(secondNote);
  });
});
