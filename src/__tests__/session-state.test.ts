import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReadingSession } from '../app/session-state';
import { restoreTabState, saveCurrentTabState } from '../app/tab-state';
import { PRESETS } from '../scripts/filters';
import type { TabData, TabManager } from '../scripts/tabs';

vi.mock('../app/ui', () => ({
  updateActivePresetButton: vi.fn(),
}));

function savedTab(): TabData {
  return {
    id: 'tab-1',
    title: 'report.pdf',
    filePath: '/tmp/report.pdf',
    filterSettings: { ...PRESETS.default },
    currentPage: 12,
    zoom: 1.75,
    zoomIntent: { kind: 'manual', scale: 1.75 },
    rotation: 270,
    scrollPosition: 4321,
    viewMode: 'continuous',
    annotations: [],
  };
}

describe('reading session visual state', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
    });
  });

  it('captures rotation and exact scroll position', () => {
    const tab = savedTab();
    const tabManager = {
      getActiveTab: () => tab,
      getTabs: () => [tab],
    } as unknown as TabManager;

    expect(captureReadingSession(tabManager).tabs[0]).toMatchObject({
      rotation: 270,
      scrollPosition: 4321,
    });
  });

  it('copies rotation and exact scroll position from the viewer into the active tab', () => {
    const tab = savedTab();
    tab.rotation = 0;
    tab.scrollPosition = 0;

    const viewer = {
      getState: () => ({
        currentPage: 7,
        totalPages: 20,
        zoom: 2,
        zoomIntent: { kind: 'manual' as const, scale: 2 },
        rotation: 90,
        fileName: tab.title,
        filePath: tab.filePath,
        viewMode: 'continuous' as const,
      }),
      getScrollPosition: () => 987,
    };
    const tabManager = {
      getActiveTab: () => tab,
      getRenderingForTab: () => viewer,
    } as unknown as TabManager;

    saveCurrentTabState(tabManager, null);

    expect(tab).toMatchObject({
      currentPage: 7,
      zoom: 2,
      rotation: 90,
      scrollPosition: 987,
      viewMode: 'continuous',
    });
  });

  it('restores geometry before the page and exact scroll position', async () => {
    const calls: string[] = [];
    const viewer = {
      setRotation: vi.fn(async (rotation: number) => {
        calls.push(`rotation:${rotation}`);
      }),
      setZoomIntent: vi.fn(async (intent: { kind: string; scale?: number }) => {
        calls.push(`zoom:${intent.kind}:${intent.scale ?? ''}`);
      }),
      setViewMode: vi.fn(async (viewMode: string) => {
        calls.push(`viewMode:${viewMode}`);
      }),
      goToReadingPosition: vi.fn(
        async (position: { page: number; location?: number; legacyOffset?: number }) => {
          calls.push(`page:${position.page}:${position.location ?? position.legacyOffset}`);
        },
      ),
      setScrollPosition: vi.fn(async (scrollPosition: number) => {
        calls.push(`scroll:${scrollPosition}`);
      }),
      applyFilter: vi.fn(),
    };
    const tab = savedTab();
    const tabManager = {
      getRenderingForTab: () => viewer,
    } as unknown as TabManager;

    await restoreTabState(tabManager, null, tab);

    expect(calls).toEqual([
      'rotation:270',
      'viewMode:continuous',
      'zoom:manual:1.75',
      'page:12:4321',
    ]);
  });
});
