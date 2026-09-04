import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ViewMode } from '../lib/document-features';
import type { ZoomIntent } from '../reader/reader-actions';
import type { PDFViewer } from '../scripts/pdf-viewer';

interface PresentationControllerOptions {
  getActiveViewer: () => PDFViewer | null;
  onStateChanged: (active: boolean) => void;
}

export class PresentationController {
  private readonly getActiveViewer: () => PDFViewer | null;
  private readonly onStateChanged: (active: boolean) => void;
  private active = false;
  private previousViewMode: ViewMode = 'single';
  private previousZoomIntent: ZoomIntent = { kind: 'manual', scale: 1 };
  private wasFullscreen = false;

  constructor(options: PresentationControllerOptions) {
    this.getActiveViewer = options.getActiveViewer;
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
    const viewer = this.getActiveViewer();
    if (!viewer || this.active) return;

    const state = viewer.getState();
    this.previousViewMode = state.viewMode;
    this.previousZoomIntent = state.zoomIntent;
    const currentWindow = getCurrentWebviewWindow();
    this.wasFullscreen = await currentWindow.isFullscreen();
    this.active = true;
    document.body.classList.add('presentation-mode');
    if (!this.wasFullscreen) await currentWindow.setFullscreen(true);

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await viewer.setViewMode('single');
    await viewer.fitToPage();
    this.onStateChanged(true);
  }

  async exit(): Promise<void> {
    if (!this.active) return;
    const viewer = this.getActiveViewer();
    this.active = false;
    document.body.classList.remove('presentation-mode');
    const currentWindow = getCurrentWebviewWindow();
    if (!this.wasFullscreen) await currentWindow.setFullscreen(false);

    if (viewer) {
      await viewer.setViewMode(this.previousViewMode);
      await viewer.setZoomIntent(this.previousZoomIntent);
    }
    this.onStateChanged(false);
  }
}
