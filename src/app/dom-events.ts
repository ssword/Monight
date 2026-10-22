import { debugLog } from '../lib/debug-log';
import { type DispatchReaderAction, readerAction } from '../reader/reader-actions';
import type { AppearancePresetId, FilterSettings } from '../scripts/filters';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SliderManager } from '../scripts/sliders';
import { isWithinAppearancePopover, setupAppearancePopover } from './presets';
import { READER_ACTION_COMMANDS } from './reader-commands';

interface DomEventContext {
  sliderManager: SliderManager | null;
  keybindManager: KeybindManager | null;
  openPdfAndRefresh: () => Promise<void>;
  activateDocument: (filePath: string) => Promise<void>;
  openRecentFile: (filePath: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
}

export interface ReaderChromeControls {
  /** Shows the active Document's current filter preset in the Appearance popover. */
  showAppearance(activeDocumentPath: string | null, filterSettings: FilterSettings): void;
  /** Chooses an Appearance preset as the popover does (View menu presets). */
  chooseAppearance(preset: AppearancePresetId): void;
}

const NAVIGATION_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];

// Setup event listeners
/** The browser's reload shortcuts, which a WebView (WebView2) may still honour. */
function isReloadChord(event: KeyboardEvent): boolean {
  if (event.key === 'F5') return true;
  return event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'r';
}

export function setupEventListeners({
  sliderManager,
  keybindManager,
  openPdfAndRefresh,
  activateDocument,
  openRecentFile,
  clearRecentFiles,
  dispatchReaderAction,
}: DomEventContext): ReaderChromeControls {
  debugLog('Setting up event listeners...');

  // Splash screen open button
  const splashOpenBtn = document.getElementById('splash-open-btn');
  if (splashOpenBtn) {
    splashOpenBtn.addEventListener('click', () => {
      debugLog('Splash open button clicked');
      openPdfAndRefresh();
    });
    debugLog('Splash open button listener attached');
  } else {
    console.error('Splash open button not found!');
  }

  document.getElementById('recent-files-list')?.addEventListener('click', (event) => {
    const target = event.target;
    const button =
      target instanceof Element ? target.closest<HTMLButtonElement>('[data-file-path]') : null;
    const filePath = button?.dataset.filePath;
    if (filePath) void openRecentFile(filePath);
  });
  document.getElementById('clear-recent-files')?.addEventListener('click', () => {
    void clearRecentFiles();
  });

  // Open file button (in toolbar)
  const openBtn = document.getElementById('open-file');
  openBtn?.addEventListener('click', () => {
    debugLog('Open button clicked');
    openPdfAndRefresh();
  });

  // Print button
  const printBtn = document.getElementById('print-file');
  printBtn?.addEventListener('click', () => {
    debugLog('Print button clicked');
    void dispatchReaderAction({ type: 'printDocument' });
  });

  // Zoom group: the same typed Reader Actions as the zoom shortcuts.
  const zoomButtons = [
    ['zoom-out', READER_ACTION_COMMANDS.zoomOut],
    ['zoom-to-fit', READER_ACTION_COMMANDS.zoomToFit],
    ['zoom-in', READER_ACTION_COMMANDS.zoomIn],
  ] as const;
  for (const [id, action] of zoomButtons) {
    document.getElementById(id)?.addEventListener('click', () => {
      void dispatchReaderAction(action());
    });
  }

  const appearance = setupAppearancePopover(sliderManager, (settings) => {
    void dispatchReaderAction(readerAction.setFilterSettings(settings));
  });

  // New tab button
  const newTabBtn = document.getElementById('new-tab-btn');
  newTabBtn?.addEventListener('click', () => {
    openPdfAndRefresh();
  });

  const tabContainer = document.getElementById('tab-container');
  tabContainer?.addEventListener('keydown', (event) => {
    const focusedTab =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    if (!focusedTab) return;

    const tabs = Array.from(tabContainer.querySelectorAll<HTMLElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(focusedTab);
    let targetTab: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        targetTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
        break;
      case 'ArrowRight':
        targetTab = tabs[(currentIndex + 1) % tabs.length];
        break;
      case 'Home':
        targetTab = tabs[0];
        break;
      case 'End':
        targetTab = tabs[tabs.length - 1];
        break;
      default:
        return;
    }

    const tabId = targetTab?.dataset.tabId;
    const filePath = targetTab?.dataset.filePath;
    if (!tabId || !filePath) return;
    event.preventDefault();
    event.stopPropagation();
    void activateDocument(filePath).then(() => {
      document.getElementById(`document-tab-${tabId}`)?.focus();
    });
  });

  // Keyboard shortcuts - use KeybindManager for dynamic keybind handling
  const handleShortcut = async (e: KeyboardEvent) => {
    if (!keybindManager || e.defaultPrevented) return;
    // Tab controls own their arrow-key focus navigation. Other configurable
    // reader shortcuts must be claimed before the EmbedPDF viewer's own listeners.
    if (
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) &&
      e
        .composedPath()
        .some((target) => target instanceof Element && target.getAttribute('role') === 'tab')
    )
      return;
    // Slider handles in the Appearance popover own their arrow-key adjustment.
    if (NAVIGATION_KEYS.includes(e.key) && isWithinAppearancePopover(e)) return;

    const actionId = keybindManager.matchEvent(e);
    if (actionId) {
      debugLog(`Keybind matched: ${actionId}`);
      e.preventDefault();
      e.stopImmediatePropagation();
      await keybindManager.handleEvent(e);
    }
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    const handled = handleShortcut(e);
    // WebView2 reloads the page on Ctrl+R, Ctrl+Shift+R and F5, which would drop
    // the reader; such chords only ever run their bound shortcut (Ctrl+R is
    // Rotate Right once Page Rotation is verified), even in text fields.
    if (isReloadChord(e)) e.preventDefault();
    return handled;
  };

  document.addEventListener('keydown', handleKeyDown, true);
  debugLog('Keyboard event listeners attached');

  return {
    showAppearance: (activeDocumentPath, filterSettings) =>
      appearance.show(activeDocumentPath, filterSettings),
    chooseAppearance: (preset) => appearance.choose(preset),
  };
}
