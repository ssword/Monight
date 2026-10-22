import type { DocumentRenderingState } from '../reader/document-rendering';
import type { ReadingSessionSnapshot } from '../reader/reader-actions';
import type { RecentDocument } from '../reader/recent-documents';
import { hydrateChromeIcons } from './chrome-icons';
import { tabBarShown } from './tab-bar';

// Show splash screen
export function showSplash(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
}

// Show PDF viewer
export function showViewer(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.add('hidden');
  if (viewer) viewer.classList.remove('hidden');
}

export function renderRecentFiles(recentFiles: readonly RecentDocument[]): void {
  const section = document.getElementById('recent-files-section');
  const list = document.getElementById('recent-files-list');
  if (!section || !list) return;

  section.classList.toggle('hidden', recentFiles.length === 0);
  list.replaceChildren();

  for (const recent of recentFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-file-button';
    button.dataset.filePath = recent.filePath;
    button.title = recent.filePath;

    const icon = document.createElement('span');
    icon.className = 'recent-file-icon';
    icon.dataset.icon = 'file-text';
    const title = document.createElement('span');
    title.className = 'recent-file-title';
    title.textContent = recent.title;
    const path = document.createElement('span');
    path.className = 'recent-file-path';
    path.textContent = recent.filePath;
    button.append(icon, title, path);
    list.appendChild(button);
  }
  hydrateChromeIcons(list);
}

/**
 * macOS draws an overlay title bar with the traffic lights inset into the toolbar;
 * Windows and Linux keep a native title bar above the same toolbar.
 */
export function applyWindowChrome(doc: Document, isMac: boolean): void {
  doc.documentElement.dataset.windowChrome = isMac ? 'overlay' : 'native';
}

/**
 * Shows or hides the tab bar by `tabBarShown`. Only visibility changes; the
 * rendered tabs keep Reading Session order.
 */
export function updateTabBarVisibility(documentCount: number, keptShown = false): void {
  document
    .getElementById('tab-bar')
    ?.classList.toggle('hidden', !tabBarShown(documentCount, keptShown));
}

// Update UI based on viewer state
export function updateUI(
  readingSession: ReadingSessionSnapshot,
  state: DocumentRenderingState | null,
): void {
  const activeDocument = readingSession.documents.find(
    ({ filePath }) => filePath === readingSession.activeDocumentPath,
  );
  if (!activeDocument || !state) return;

  // Update file name
  const fileName = document.getElementById('file-name');
  if (fileName) {
    fileName.textContent = activeDocument.title || 'No file loaded';
  }

  const pageStatus = document.getElementById('page-status');
  if (pageStatus) {
    pageStatus.textContent =
      state.totalPages > 0 ? `Page ${state.currentPage} of ${state.totalPages}` : '';
  }
}

/** The effective shortcuts shown in tooltips and the splash hint; null when unbound. */
export interface KeyboardHints {
  readonly openFile: string | null;
  readonly print: string | null;
}

const withShortcut = (label: string, shortcut: string | null) =>
  shortcut ? `${label} (${shortcut})` : label;

/** Shows the reader's effective Open and Print bindings, or none when unbound. */
export function updateKeyboardHints({ openFile, print }: KeyboardHints): void {
  const titles: [string, string, string | null][] = [
    ['open-file', 'Open PDF', openFile],
    ['new-tab-btn', 'Open New PDF', openFile],
    ['print-file', 'Print', print],
  ];
  for (const [id, label, shortcut] of titles) {
    const element = document.getElementById(id);
    if (element) element.title = withShortcut(label, shortcut);
  }

  const hintText = document.querySelector('.hint-text');
  if (hintText) {
    hintText.textContent = openFile
      ? `Press ${openFile} to open a PDF file`
      : 'Open a PDF file to start reading';
  }
}
