import { debugLog } from '../lib/debug-log';
import { type DispatchReaderAction, readerAction } from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SliderManager } from '../scripts/sliders';
import { setupPresetButtons, toggleDarkConfigurator } from './presets';

interface DomEventContext {
  sliderManager: SliderManager | null;
  keybindManager: KeybindManager | null;
  openPdfAndRefresh: () => Promise<void>;
  activateDocument: (filePath: string) => Promise<void>;
  openRecentFile: (filePath: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
}

// Setup event listeners
export function setupEventListeners({
  sliderManager,
  keybindManager,
  openPdfAndRefresh,
  activateDocument,
  openRecentFile,
  clearRecentFiles,
  dispatchReaderAction,
}: DomEventContext): void {
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
    ['zoom-out', () => readerAction.zoomOut()],
    ['zoom-to-fit', () => readerAction.setZoomIntent({ kind: 'fit-page' })],
    ['zoom-in', () => readerAction.zoomIn()],
  ] as const;
  for (const [id, action] of zoomButtons) {
    document.getElementById(id)?.addEventListener('click', () => {
      void dispatchReaderAction(action());
    });
  }

  // Interim presets menu, until the Appearance popover replaces it.
  const appearanceToggle = document.getElementById('appearance-toggle');
  const presetMenu = document.getElementById('preset-menu');
  const setPresetMenuOpen = (open: boolean) => {
    presetMenu?.classList.toggle('hidden', !open);
    appearanceToggle?.setAttribute('aria-expanded', String(open));
  };
  const presetMenuOpen = () => (presetMenu ? !presetMenu.classList.contains('hidden') : false);
  appearanceToggle?.addEventListener('click', () => setPresetMenuOpen(!presetMenuOpen()));
  presetMenu?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.preset-btn'))
      setPresetMenuOpen(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!presetMenuOpen()) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (presetMenu?.contains(target) || appearanceToggle?.contains(target))) return;
    setPresetMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && presetMenuOpen()) {
      setPresetMenuOpen(false);
      appearanceToggle?.focus();
    }
  });

  // Setup preset buttons
  setupPresetButtons(sliderManager, (settings) => {
    void dispatchReaderAction(readerAction.setFilterSettings(settings));
  });

  // New tab button
  const newTabBtn = document.getElementById('new-tab-btn');
  newTabBtn?.addEventListener('click', () => {
    openPdfAndRefresh();
  });

  // Close configurator button
  const closeConfigBtn = document.getElementById('close-configurator');
  closeConfigBtn?.addEventListener('click', () => {
    toggleDarkConfigurator(sliderManager);
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
  const handleKeyDown = async (e: KeyboardEvent) => {
    if (!keybindManager || e.defaultPrevented) return;
    // Tab controls own their arrow-key focus navigation. Other configurable
    // reader shortcuts must be claimed before the ready-made viewer's listeners.
    if (
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) &&
      e
        .composedPath()
        .some((target) => target instanceof Element && target.getAttribute('role') === 'tab')
    )
      return;

    const actionId = keybindManager.matchEvent(e);
    if (actionId) {
      debugLog(`Keybind matched: ${actionId}`);
      e.preventDefault();
      e.stopImmediatePropagation();
      await keybindManager.handleEvent(e);
    }
  };

  document.addEventListener('keydown', handleKeyDown, true);
  debugLog('Keyboard event listeners attached');
}
