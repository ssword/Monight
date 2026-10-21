// @vitest-environment happy-dom

import { PdfAnnotationSubtype, Rotation } from '@embedpdf/snippet';
import { describe, expect, it, vi } from 'vitest';
import { createEmbedPdfDocumentSurfaceFactory } from '../app/embedpdf-document-surface';
import { embedPdfAnnotationSnapshots } from '../app/embedpdf-navigation-geometry';
import type { EmbedPdfViewerRuntime } from '../app/embedpdf-viewer-runtime';
import type { DocumentAnnotationSnapshot } from '../reader/document-queries';

const PAGE = { size: { width: 600, height: 800 }, rotation: Rotation.Degree0 };

type Tracked = Parameters<typeof embedPdfAnnotationSnapshots>[0][number];

const tracked = (
  type: PdfAnnotationSubtype,
  id: string,
  overrides: Record<string, unknown> = {},
  commitState: Tracked['commitState'] = 'synced',
): Tracked =>
  ({
    commitState,
    object: {
      type,
      id,
      pageIndex: 0,
      rect: { origin: { x: 100, y: 200 }, size: { width: 50, height: 20 } },
      author: 'Andrew Chen',
      ...overrides,
    },
  }) as Tracked;

describe('EmbedPDF Annotation snapshots', () => {
  it('lists text markups and notes from any author and leaves every other kind out', () => {
    const snapshots = embedPdfAnnotationSnapshots(
      [
        tracked(PdfAnnotationSubtype.HIGHLIGHT, 'highlight', {
          contents: 'Preview native highlight 75',
          strokeColor: '#FFCD45',
          modified: new Date('2026-10-20T08:00:00.000Z'),
        }),
        tracked(PdfAnnotationSubtype.UNDERLINE, 'underline', { author: 'ssword' }),
        tracked(PdfAnnotationSubtype.STRIKEOUT, 'strikeout', { author: undefined }),
        tracked(PdfAnnotationSubtype.SQUIGGLY, 'squiggly'),
        tracked(PdfAnnotationSubtype.TEXT, 'note', {
          contents: 'Native comment',
          author: 'Guest',
          created: new Date('2026-10-19T08:00:00.000Z'),
        }),
        tracked(PdfAnnotationSubtype.POPUP, 'popup'),
        tracked(PdfAnnotationSubtype.LINK, 'link'),
        tracked(PdfAnnotationSubtype.INK, 'ink'),
        tracked(PdfAnnotationSubtype.STAMP, 'stamp'),
        tracked(PdfAnnotationSubtype.SQUARE, 'square'),
        tracked(PdfAnnotationSubtype.FREETEXT, 'free-text'),
        tracked(PdfAnnotationSubtype.TEXT, 'deleted', {}, 'deleted'),
      ],
      [PAGE],
    );

    expect(snapshots.map(({ id, kind }) => [id, kind])).toEqual([
      ['highlight', 'highlight'],
      ['underline', 'underline'],
      ['strikeout', 'strikeout'],
      ['squiggly', 'squiggly'],
      ['note', 'note'],
    ]);
    expect(snapshots[0]).toEqual({
      id: 'highlight',
      kind: 'highlight',
      pageNumber: 1,
      readingPosition: { page: 1, location: 0.25 },
      author: 'Andrew Chen',
      contents: 'Preview native highlight 75',
      color: '#FFCD45',
      modified: '2026-10-20T08:00:00.000Z',
    });
    expect(snapshots[1]?.author).toBe('ssword');
    expect(snapshots[2]?.author).toBe('');
    expect(snapshots[4]).toMatchObject({
      author: 'Guest',
      contents: 'Native comment',
      modified: '2026-10-19T08:00:00.000Z',
    });
  });

  it('orders snapshots by page, then from the top of the page', () => {
    const snapshots = embedPdfAnnotationSnapshots(
      [
        tracked(PdfAnnotationSubtype.TEXT, 'page-2', { pageIndex: 1 }),
        tracked(PdfAnnotationSubtype.TEXT, 'lower', {
          rect: { origin: { x: 10, y: 600 }, size: { width: 20, height: 20 } },
        }),
        tracked(PdfAnnotationSubtype.HIGHLIGHT, 'upper', {
          rect: { origin: { x: 300, y: 80 }, size: { width: 20, height: 20 } },
        }),
      ],
      [PAGE, PAGE],
    );

    expect(snapshots.map(({ id, readingPosition }) => [id, readingPosition])).toEqual([
      ['upper', { page: 1, location: 0.1 }],
      ['lower', { page: 1, location: 0.75 }],
      ['page-2', { page: 2, location: 0.25 }],
    ]);
  });

  it('measures the reading location along the displayed height of a rotated page', () => {
    const rect = { origin: { x: 150, y: 200 }, size: { width: 60, height: 40 } };
    const at = (rotation: Rotation) =>
      embedPdfAnnotationSnapshots(
        [tracked(PdfAnnotationSubtype.TEXT, 'n', { rect })],
        [{ size: PAGE.size, rotation }],
      )[0]?.readingPosition.location;

    // The displayed top edge of the rect, as a fraction of the displayed page height.
    expect(at(Rotation.Degree90)).toBeCloseTo(150 / 600);
    expect(at(Rotation.Degree180)).toBeCloseTo(1 - 240 / 800);
    expect(at(Rotation.Degree270)).toBeCloseTo(1 - 210 / 600);
  });
});

describe('EmbedPDF Document surface Annotations', () => {
  it('exposes the live Annotation list to Document Queries and reveals through rendering', async () => {
    document.body.innerHTML = '<div id="pdf-container"></div>';
    const live: DocumentAnnotationSnapshot[] = [
      {
        id: 'note',
        kind: 'note',
        pageNumber: 1,
        readingPosition: { page: 1, location: 0.2 },
        author: 'Guest',
        contents: 'Native comment',
        color: null,
        modified: null,
      },
    ];
    const viewer = {
      open: vi.fn(async () => undefined),
      pageCount: () => 1,
      annotations: vi.fn(() => live),
      revealAnnotation: vi.fn(),
      destroy: vi.fn(async () => undefined),
    } as unknown as EmbedPdfViewerRuntime;
    const surface = await createEmbedPdfDocumentSurfaceFactory({
      createViewer: async () => viewer,
    })({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes: new Uint8Array([1]),
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: vi.fn(async () => undefined),
        zoomIntentRequested: vi.fn(async () => undefined),
      },
    });

    expect(surface.runtime.annotations?.()).toEqual(live);
    surface.rendering.revealAnnotation?.('note');
    expect(viewer.revealAnnotation).toHaveBeenCalledExactlyOnceWith('note');

    await surface.runtime.destroy();
    surface.rendering.revealAnnotation?.('note');
    expect(surface.runtime.annotations?.()).toEqual([]);
    expect(viewer.revealAnnotation).toHaveBeenCalledOnce();
  });
});
