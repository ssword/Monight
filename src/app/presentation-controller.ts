import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ViewMode } from '../lib/document-features';
import type { DocumentRenderingState } from '../reader/document-rendering';
import type { PresentationExitOptions, ZoomIntent } from '../reader/reader-actions';

export interface PresentationSurface {
  snapshot(): Pick<DocumentRenderingState, 'viewMode' | 'zoomIntent'>;
  setViewMode(viewMode: ViewMode): Promise<void>;
  fitToPage(): Promise<void>;
  setZoomIntent(zoomIntent: ZoomIntent): Promise<void>;
}

interface PresentationControllerOptions {
  getActivePresentation: () => PresentationSurface | null;
  onStateChanged: (active: boolean) => void;
}

export class PresentationController {
  private readonly getActivePresentation: () => PresentationSurface | null;
  private readonly onStateChanged: (active: boolean) => void;
  private active = false;
  private previousViewMode: ViewMode = 'single';
  private previousZoomIntent: ZoomIntent = { kind: 'manual', scale: 1 };
  private wasFullscreen = false;

  constructor(options: PresentationControllerOptions) {
    this.getActivePresentation = options.getActivePresentation;
    this.onStateChanged = options.onStateChanged;
    document.getElementById('presentation-mode')?.addEventListener('click', () => {
      void this.toggle();
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (this.active && event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.exit();
        }
      },
      true,
    );
  }

  isActive(): boolean {
    return this.active;
  }

  async toggle(): Promise<void> {
    if (this.active) {
      await this.exit();
    } else {
      await this.enter();
    }
  }

  async enter(): Promise<void> {
    const presentation = this.getActivePresentation();
    if (!presentation || this.active) return;

    const state = presentation.snapshot();
    this.previousViewMode = state.viewMode;
    this.previousZoomIntent = state.zoomIntent;
    const currentWindow = getCurrentWebviewWindow();
    this.wasFullscreen = await currentWindow.isFullscreen();
    this.active = true;
    document.body.classList.add('presentation-mode');
    if (!this.wasFullscreen) await currentWindow.setFullscreen(true);

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await presentation.setViewMode('single');
    await presentation.fitToPage();
    this.onStateChanged(true);
  }

  async exit(options: PresentationExitOptions = {}): Promise<void> {
    if (!this.active) return;
    const presentation = this.getActivePresentation();
    this.active = false;
    document.body.classList.remove('presentation-mode');
    const currentWindow = getCurrentWebviewWindow();
    if (!this.wasFullscreen) await currentWindow.setFullscreen(false);

    if (presentation && options.restoreVisualState !== false) {
      await presentation.setViewMode(this.previousViewMode);
      await presentation.setZoomIntent(this.previousZoomIntent);
    }
    this.onStateChanged(false);
  }
}
