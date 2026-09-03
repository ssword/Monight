import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../scripts/filters';
import type { ReadingSession } from '../scripts/settings';

const mocks = vi.hoisted(() => ({
  openFiles: vi.fn(),
}));

vi.mock('../app/file-actions', () => ({ openFiles: mocks.openFiles }));
vi.mock('../app/ui', () => ({ updateActivePresetButton: vi.fn() }));

import { restoreReadingSession } from '../app/session-state';

function saved(filePath: string, currentPage: number) {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    filterSettings: { ...PRESETS.default },
    currentPage,
    zoom: 1,
    zoomIntent: { kind: 'fit-width' as const },
    rotation: 0,
    scrollPosition: 0,
    viewMode: 'continuous' as const,
  };
}

function fakeTab(filePath: string, currentPage: number) {
  return {
    id: filePath,
    ...saved(filePath, currentPage),
    annotations: [],
  };
}

describe('Reading Session restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
  });

  it('restores the saved active Document first without stealing explicit startup activation', async () => {
    const explicit = fakeTab('/docs/explicit.pdf', 12);
    const tabs = [explicit];
    let active = explicit;
    const activationOrder: string[] = [];
    const restoredPositions: unknown[] = [];
    const manager = {
      getTabs: () => tabs,
      getActiveTab: () => active,
      setDocumentOrder: vi.fn((filePaths: readonly string[]) => {
        tabs.sort(
          (left, right) => filePaths.indexOf(left.filePath) - filePaths.indexOf(right.filePath),
        );
      }),
      activateTab: vi.fn(async (id: string) => {
        const tab = tabs.find((item) => item.id === id);
        if (tab) {
          active = tab;
          activationOrder.push(tab.filePath);
        }
      }),
      getViewerForTab: vi.fn((id: string) => {
        const tab = tabs.find((item) => item.id === id);
        return {
          applyFilter: vi.fn(),
          setRotation: vi.fn(),
          setZoomIntent: vi.fn(),
          setViewMode: vi.fn(),
          goToReadingPosition: vi.fn((position) => {
            restoredPositions.push(position);
          }),
          getReadingPosition: () => ({ page: tab?.currentPage ?? 1, location: 0.4 }),
        };
      }),
    };
    mocks.openFiles.mockImplementation(
      async ([filePath]: string[], options: { activate?: boolean }) => {
        const existing = tabs.find((tab) => tab.filePath === filePath);
        if (existing) {
          if (options.activate !== false) await manager.activateTab(existing.id);
          return 0;
        }
        const tab = fakeTab(filePath, 1);
        tabs.push(tab);
        if (options.activate !== false) await manager.activateTab(tab.id);
        return 1;
      },
    );
    const session: ReadingSession = {
      version: 1,
      activeFilePath: '/docs/saved-active.pdf',
      tabs: [
        saved('/docs/other.pdf', 3),
        saved('/docs/saved-active.pdf', 7),
        saved('/docs/explicit.pdf', 4),
      ],
    };
    session.tabs[0].readingPosition = { page: 3, location: 0.6 };

    const result = await restoreReadingSession(session, {
      tabManager: manager as never,
      sliderManager: null,
      getInitialFilterSettings: () => ({ ...PRESETS.default }),
      getInitialViewMode: () => 'continuous',
      foregroundDocumentPath: '/docs/explicit.pdf',
    });

    expect(mocks.openFiles.mock.calls.map(([paths]) => paths[0])).toEqual([
      '/docs/saved-active.pdf',
      '/docs/other.pdf',
      '/docs/explicit.pdf',
    ]);
    expect(active.filePath).toBe('/docs/explicit.pdf');
    expect(tabs.map((tab) => tab.filePath)).toEqual([
      '/docs/other.pdf',
      '/docs/saved-active.pdf',
      '/docs/explicit.pdf',
    ]);
    expect(explicit.currentPage).toBe(12);
    expect(explicit.zoomIntent).toEqual({ kind: 'fit-width' });
    expect(result).toEqual({ opened: 3, failed: 0, failedPaths: [] });
    expect(activationOrder).not.toContain('/docs/saved-active.pdf');
    expect(activationOrder).not.toContain('/docs/other.pdf');
    expect(restoredPositions).toContainEqual({ page: 3, location: 0.6 });
  });

  it('returns every failed restored path for authoritative pruning', async () => {
    const manager = {
      getTabs: () => [],
      setDocumentOrder: vi.fn(),
      activateTab: vi.fn(),
      getViewerForTab: vi.fn(),
    };
    mocks.openFiles.mockResolvedValue(0);
    const session: ReadingSession = {
      version: 1,
      activeFilePath: '/docs/missing.pdf',
      tabs: [saved('/docs/missing.pdf', 1), saved('/docs/also-missing.pdf', 1)],
    };

    const result = await restoreReadingSession(session, {
      tabManager: manager as never,
      sliderManager: null,
      getInitialFilterSettings: () => ({ ...PRESETS.default }),
      getInitialViewMode: () => 'continuous',
    });

    expect(result).toEqual({
      opened: 0,
      failed: 2,
      failedPaths: ['/docs/missing.pdf', '/docs/also-missing.pdf'],
    });
  });
});
