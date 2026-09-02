import type { PdfSearchMatch, SearchProgress } from '../lib/document-features';
import type { PDFViewer } from '../scripts/pdf-viewer';

export class SearchController {
  private readonly getActiveViewer: () => PDFViewer | null;
  private readonly bar: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private matches: PdfSearchMatch[] = [];
  private activeIndex = -1;
  private searchTimer: number | null = null;
  private searchEpoch = 0;
  private searchedViewer: PDFViewer | null = null;
  private scanProgress: { pageNumber: number; totalPages: number } | null = null;

  constructor(getActiveViewer: () => PDFViewer | null) {
    this.getActiveViewer = getActiveViewer;
    this.bar = this.requireElement<HTMLElement>('search-bar');
    this.input = this.requireElement<HTMLInputElement>('search-input');
    this.status = this.requireElement<HTMLElement>('search-status');
    this.previousButton = this.requireElement<HTMLButtonElement>('search-previous');
    this.nextButton = this.requireElement<HTMLButtonElement>('search-next');

    this.input.addEventListener('input', () => this.scheduleSearch());
    this.input.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        this.input.select();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void this.move(event.shiftKey ? -1 : 1);
      }
    });
    this.previousButton.addEventListener('click', () => void this.move(-1));
    this.nextButton.addEventListener('click', () => void this.move(1));
    this.requireElement<HTMLButtonElement>('search-close').addEventListener('click', () =>
      this.close(),
    );
    this.requireElement<HTMLButtonElement>('open-search').addEventListener('click', () =>
      this.open(),
    );
  }

  private requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Search control '${id}' not found`);
    return element as T;
  }

  open(): void {
    if (!this.getActiveViewer()) return;
    this.bar.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (this.input.value.trim() && this.searchedViewer !== this.getActiveViewer()) {
      void this.runSearch();
    }
  }

  close(): void {
    this.searchEpoch += 1;
    this.bar.classList.add('hidden');
    this.clearSearchTimer();
    this.searchedViewer?.clearSearch();
    this.searchedViewer = null;
    this.matches = [];
    this.activeIndex = -1;
    this.scanProgress = null;
    this.status.textContent = 'Type to search';
    this.setNavigationEnabled(false);
  }

  activeDocumentChanged(): void {
    this.searchEpoch += 1;
    this.searchedViewer?.clearSearch();
    this.searchedViewer = null;
    this.matches = [];
    this.activeIndex = -1;
    this.scanProgress = null;
    this.setNavigationEnabled(false);
    if (!this.bar.classList.contains('hidden') && this.input.value.trim()) {
      void this.runSearch();
    } else {
      this.status.textContent = this.input.value.trim()
        ? 'Press Enter to search'
        : 'Type to search';
    }
  }

  private scheduleSearch(): void {
    this.searchEpoch += 1;
    this.searchedViewer?.clearSearch();
    this.matches = [];
    this.activeIndex = -1;
    this.scanProgress = null;
    this.setNavigationEnabled(false);
    this.clearSearchTimer();
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.runSearch();
    }, 180);
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private async runSearch(): Promise<void> {
    const viewer = this.getActiveViewer();
    const query = this.input.value.trim();
    const epoch = ++this.searchEpoch;
    this.searchedViewer?.clearSearch();
    this.searchedViewer = viewer;
    this.matches = [];
    this.activeIndex = -1;
    this.scanProgress = null;

    if (!viewer || !query) {
      this.status.textContent = 'Type to search';
      return;
    }

    this.status.textContent = 'Searching…';
    this.setNavigationEnabled(false);
    this.scanProgress = null;
    let matches: PdfSearchMatch[];
    try {
      matches = await viewer.searchText(query, (progress) =>
        this.handleSearchProgress(epoch, viewer, progress),
      );
    } catch (error) {
      if (!this.isCurrentSearch(epoch, viewer)) return;
      this.scanProgress = null;
      console.error('Document search failed:', error);
      this.status.textContent = 'Search unavailable';
      this.setNavigationEnabled(false);
      return;
    }
    if (!this.isCurrentSearch(epoch, viewer)) return;

    this.scanProgress = null;
    this.matches = matches;
    this.setNavigationEnabled(matches.length > 0);
    if (matches.length === 0) {
      this.status.textContent = 'No matches';
      return;
    }

    if (this.activeIndex < 0) {
      this.activeIndex = 0;
      await viewer.revealSearchMatch(matches[0]);
    }
    if (!this.isCurrentSearch(epoch, viewer)) return;
    this.updateStatus();
  }

  private isCurrentSearch(epoch: number, viewer: PDFViewer): boolean {
    return epoch === this.searchEpoch && viewer === this.getActiveViewer();
  }

  /** Applies partial results emitted while pages are still being scanned. */
  private handleSearchProgress(epoch: number, viewer: PDFViewer, progress: SearchProgress): void {
    if (!this.isCurrentSearch(epoch, viewer)) return;

    this.scanProgress = { pageNumber: progress.pageNumber, totalPages: progress.totalPages };
    this.matches = progress.matches;
    if (this.matches.length > 0) {
      this.setNavigationEnabled(true);
      if (this.activeIndex < 0) {
        this.activeIndex = 0;
        void this.revealSearchMatchWhileCurrent(epoch, viewer, this.matches[0]);
      }
    }
    this.updateStatus();
  }

  private async move(direction: -1 | 1): Promise<void> {
    if (this.matches.length === 0) {
      // A scan is already running; wait for it to emit matches instead of restarting.
      if (this.scanProgress) return;
      await this.runSearch();
      return;
    }

    this.activeIndex = (this.activeIndex + direction + this.matches.length) % this.matches.length;
    const viewer = this.getActiveViewer();
    if (!viewer) return;
    const epoch = this.searchEpoch;
    await viewer.revealSearchMatch(this.matches[this.activeIndex]);
    if (!this.isCurrentSearch(epoch, viewer)) return;
    this.updateStatus();
  }

  private async revealSearchMatchWhileCurrent(
    epoch: number,
    viewer: PDFViewer,
    match: PdfSearchMatch,
  ): Promise<void> {
    if (!this.isCurrentSearch(epoch, viewer)) return;
    await viewer.revealSearchMatch(match);
  }

  private updateStatus(): void {
    const scanSuffix = this.scanProgress
      ? ` · scanning ${this.scanProgress.pageNumber}/${this.scanProgress.totalPages}`
      : '';
    if (this.matches.length === 0) {
      this.status.textContent = this.scanProgress ? `Searching…${scanSuffix}` : 'No matches';
      return;
    }
    const match = this.matches[this.activeIndex];
    this.status.textContent = match
      ? `${this.activeIndex + 1} of ${this.matches.length} · page ${match.pageNumber}${scanSuffix}`
      : `${this.matches.length} matches${scanSuffix}`;
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.previousButton.disabled = !enabled;
    this.nextButton.disabled = !enabled;
  }
}
