import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentWindow = vi.hoisted(() => ({
  isFullscreen: vi.fn(async () => false),
  setFullscreen: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => currentWindow,
}));

describe('PresentationController', () => {
  beforeEach(() => {
    currentWindow.isFullscreen.mockClear();
    currentWindow.setFullscreen.mockClear();

    const bodyClasses = new Set<string>();
    vi.stubGlobal('document', {
      body: {
        classList: {
          add: (className: string) => bodyClasses.add(className),
          remove: (className: string) => bodyClasses.delete(className),
          contains: (className: string) => bodyClasses.has(className),
        },
      },
      getElementById: () => ({
        addEventListener: vi.fn(),
      }),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
  });

  it('enters fullscreen single-page mode and restores the previous view', async () => {
    const { PresentationController } = await import('../app/presentation-controller');
    const viewer = {
      getState: () => ({
        viewMode: 'spread' as const,
        zoom: 1.75,
        zoomIntent: { kind: 'fit-width' as const },
      }),
      setViewMode: vi.fn(async () => {}),
      fitToPage: vi.fn(async () => {}),
      setZoomIntent: vi.fn(async () => {}),
    };
    const onStateChanged = vi.fn();
    const controller = new PresentationController({
      getActiveViewer: () => viewer as never,
      onStateChanged,
    });

    await controller.enter();

    expect(controller.isActive()).toBe(true);
    expect(document.body.classList.contains('presentation-mode')).toBe(true);
    expect(currentWindow.setFullscreen).toHaveBeenCalledWith(true);
    expect(viewer.setViewMode).toHaveBeenCalledWith('single');
    expect(viewer.fitToPage).toHaveBeenCalled();

    await controller.exit();

    expect(controller.isActive()).toBe(false);
    expect(document.body.classList.contains('presentation-mode')).toBe(false);
    expect(currentWindow.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(viewer.setViewMode).toHaveBeenLastCalledWith('spread');
    expect(viewer.setZoomIntent).toHaveBeenCalledWith({ kind: 'fit-width' });
    expect(onStateChanged.mock.calls).toEqual([[true], [false]]);
  });
});
