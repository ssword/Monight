// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { updateUI } from '../app/ui';
import type { DocumentRenderingState } from '../reader/document-rendering';
import type { ReadingSessionSnapshot } from '../reader/reader-actions';

const session = (activeDocumentPath: string): ReadingSessionSnapshot => ({
  schemaVersion: 2,
  revision: 0,
  activeDocumentPath,
  documents: [
    {
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      readingPosition: { page: 1, location: 0 },
    },
    {
      filePath: '/docs/thesis.pdf',
      title: 'thesis.pdf',
      readingPosition: { page: 1, location: 0 },
    },
  ],
});

const rendering = (
  filePath: string,
  currentPage: number,
  totalPages: number,
): DocumentRenderingState => ({
  currentPage,
  totalPages,
  zoom: 1,
  zoomIntent: { kind: 'manual', scale: 1 },
  rotation: 0,
  fileName: filePath.split('/').pop() ?? '',
  filePath,
  viewMode: 'continuous',
});

describe('toolbar title block', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="toolbar-title">
        <span id="file-name"></span>
        <span id="page-status"></span>
      </div>
    `;
  });

  const title = () => ({
    fileName: document.getElementById('file-name')?.textContent,
    pageStatus: document.getElementById('page-status')?.textContent,
  });

  it('shows the active Document file name with a live page count', () => {
    updateUI(session('/docs/report.pdf'), rendering('/docs/report.pdf', 1, 12));
    expect(title()).toEqual({ fileName: 'report.pdf', pageStatus: 'Page 1 of 12' });

    // A settled scroll reports a new current page.
    updateUI(session('/docs/report.pdf'), rendering('/docs/report.pdf', 7, 12));
    expect(title()).toEqual({ fileName: 'report.pdf', pageStatus: 'Page 7 of 12' });
  });

  it('follows a Document switch', () => {
    updateUI(session('/docs/report.pdf'), rendering('/docs/report.pdf', 7, 12));
    updateUI(session('/docs/thesis.pdf'), rendering('/docs/thesis.pdf', 3, 240));
    expect(title()).toEqual({ fileName: 'thesis.pdf', pageStatus: 'Page 3 of 240' });
  });

  it('shows no page count before the Document has pages', () => {
    updateUI(session('/docs/thesis.pdf'), rendering('/docs/thesis.pdf', 0, 0));
    expect(title()).toEqual({ fileName: 'thesis.pdf', pageStatus: '' });
  });
});
