import type { DocumentRenderingState } from '../reader/document-rendering';
import type { ReadingSessionSnapshot } from '../reader/reader-actions';
import type { RecentDocument } from '../reader/recent-documents';
import { hydrateChromeIcons } from './chrome-icons';

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
 * The tab bar is shown only while two or more Documents are open, like macOS tabs.
 * Only visibility changes; the rendered tabs keep Reading Session order.
 */
export function updateTabBarVisibility(documentCount: number): void {
  document.getElementById('tab-bar')?.classList.toggle('hidden', documentCount < 2);
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

// Update keyboard shortcut hints based on platform
export function updateKeyboardHints(isMac: boolean): void {
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  // Update tooltips
  const openBtn = document.getElementById('open-file');
  if (openBtn) openBtn.title = `Open PDF (${modKey}+O)`;

  const printBtn = document.getElementById('print-file');
  if (printBtn) printBtn.title = `Print (${modKey}+P)`;

  // Update hint text
  const hintText = document.querySelector('.hint-text');
  if (hintText) hintText.textContent = `Press ${modKey}+O to open a PDF file`;
}
