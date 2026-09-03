import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreDocumentStateInTabManager } from '../app/session-restoration-runtime';
import type { ReadingSessionDocument } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

vi.mock('../app/ui', () => ({ updateActivePresetButton: vi.fn() }));

function savedDocument(filePath: string): ReadingSessionDocument {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    readingPosition: { page: 4, location: 0.6 },
    visualState: {
      filterSettings: {
        brightness: 8,
        grayscale: 100,
        invert: 92,
        sepia: 100,
        hue: 295,
        extraBrightness: -6,
      },
      zoomIntent: { kind: 'fit-width' },
      rotation: 90,
      viewMode: 'continuous',
    },
  };
}

describe('Reading Session restoration runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
  });

  it('reuses the saved Visual State while preserving the explicit foreground Reading Position', async () => {
    const saved = savedDocument('/docs/explicit.pdf');
    const restoredPositions: unknown[] = [];
    const tab = {
      id: 'explicit',
      filePath: saved.filePath,
      title: 'open-now.pdf',
      filterSettings: { ...PRESETS.default },
      currentPage: 12,
      zoom: 1,
      zoomIntent: { kind: 'manual' as const, scale: 1 },
      rotation: 0,
      scrollPosition: 25,
      viewMode: 'single' as const,
      annotations: [],
    };
    const manager = {
      getTabs: vi.fn(() => [tab]),
      getViewerForTab: vi.fn(() => ({
        applyFilter: vi.fn(),
        setRotation: vi.fn(),
        setZoomIntent: vi.fn(),
        setViewMode: vi.fn(),
        goToReadingPosition: vi.fn((position) => {
          restoredPositions.push(position);
        }),
        getReadingPosition: () => ({ page: 12, location: 0.4 }),
      })),
    };

    const outcome = await restoreDocumentStateInTabManager(
      {
        tabManager: manager as never,
        sliderManager: null,
        getInitialFilterSettings: () => ({ ...PRESETS.default }),
        getInitialViewMode: () => 'single',
      },
      saved,
      { preserveCurrentReadingPosition: true },
    );

    expect(outcome).toEqual({ status: 'restored' });
    expect(tab.title).toBe('explicit.pdf');
    expect(tab.filterSettings).toEqual(saved.visualState?.filterSettings);
    expect(tab.zoomIntent).toEqual({ kind: 'fit-width' });
    expect(tab.zoom).toBe(1);
    expect(tab.rotation).toBe(90);
    expect(tab.viewMode).toBe('continuous');
    expect(restoredPositions).toContainEqual({ page: 12, location: 0.4 });
  });

  it('returns a failed outcome when the restored Document never becomes available', async () => {
    const saved = savedDocument('/docs/missing.pdf');
    const manager = {
      getTabs: vi.fn(() => []),
      getViewerForTab: vi.fn(),
    };

    const outcome = await restoreDocumentStateInTabManager(
      {
        tabManager: manager as never,
        sliderManager: null,
        getInitialFilterSettings: () => ({ ...PRESETS.default }),
        getInitialViewMode: () => 'single',
      },
      saved,
      { preserveCurrentReadingPosition: false },
    );

    expect(outcome).toEqual({
      status: 'failed',
      message: 'Failed to restore /docs/missing.pdf: runtime did not create the Document.',
    });
  });

  it('converts restore projection failures into a per-Document failed outcome', async () => {
    const saved = savedDocument('/docs/report.pdf');
    const manager = {
      getTabs: vi.fn(() => [
        {
          id: 'report',
          filePath: saved.filePath,
          title: saved.title,
          filterSettings: { ...PRESETS.default },
          currentPage: 1,
          zoom: 1,
          zoomIntent: { kind: 'manual' as const, scale: 1 },
          rotation: 0,
          scrollPosition: 0,
          viewMode: 'single' as const,
          annotations: [],
        },
      ]),
      getViewerForTab: vi.fn(() => ({
        applyFilter: vi.fn(),
        setRotation: vi.fn(async () => {
          throw new Error('render failed');
        }),
        setZoomIntent: vi.fn(),
        setViewMode: vi.fn(),
        goToReadingPosition: vi.fn(),
        getReadingPosition: () => ({ page: 1, location: 0 }),
      })),
    };

    const outcome = await restoreDocumentStateInTabManager(
      {
        tabManager: manager as never,
        sliderManager: null,
        getInitialFilterSettings: () => ({ ...PRESETS.default }),
        getInitialViewMode: () => 'single',
      },
      saved,
      { preserveCurrentReadingPosition: false },
    );

    expect(outcome).toEqual({
      status: 'failed',
      message: 'Failed to restore /docs/report.pdf: render failed',
    });
  });
});
