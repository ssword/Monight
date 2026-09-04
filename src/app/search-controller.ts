import type { PdfSearchMatch, SearchProgress } from '../lib/document-features';
import type { DocumentAccess } from '../reader/document-access';

export type ActiveSearchDocument = DocumentAccess;

export class SearchController {
  private readonly getActiveDocument: () => ActiveSearchDocument | null;
  private readonly bar: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private matches: PdfSearchMatch[] = [];
  private activeIndex = -1;
  private searchTimer: number | null = null;
  private searchEpoch = 0;
  private searchedDocument: ActiveSearchDocument | null = null;
  private isScanning = false;
  private scanProgress: { pageNumber: number; totalPages: number } | null = null;
  private revealQueue: Promise<void> = Promise.resolve();
  private revealRequest = 0;

  constructor(getActiveDocument: () => ActiveSearchDocument | null) {
    this.getActiveDocument = getActiveDocument;
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
    if (!this.getActiveDocument()) return;
    this.bar.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (
      this.input.value.trim() &&
      !this.isSameDocument(this.searchedDocument, this.getActiveDocument())
    ) {
      void this.runSearch();
    }
  }

  close(): void {
    this.invalidateSearch();
    this.bar.classList.add('hidden');
    this.clearSearchTimer();
    this.status.textContent = 'Type to search';
    this.setNavigationEnabled(false);
  }

  activeDocumentChanged(): void {
    this.invalidateSearch();
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
    this.invalidateSearch();
    this.setNavigationEnabled(false);
    this.clearSearchTimer();
    if (!this.input.value.trim()) {
      this.status.textContent = 'Type to search';
      return;
    }

    this.status.textContent = 'Searching…';
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
    this.clearSearchTimer();
    const activeDocument = this.getActiveDocument();
    const query = this.input.value.trim();
    const epoch = this.invalidateSearch();
    this.searchedDocument = activeDocument;

    if (!activeDocument || !query) {
      this.status.textContent = 'Type to search';
      return;
    }

    this.status.textContent = 'Searching…';
    this.setNavigationEnabled(false);
    this.isScanning = true;
    this.scanProgress = null;
    let matches: PdfSearchMatch[];
    try {
      matches = [
        ...(await activeDocument.query.search(query, {
          onProgress: (progress) =>
            this.handleSearchProgress(epoch, activeDocument, query, progress),
        })),
      ];
    } catch (error) {
      if (!this.isCurrentSearch(epoch, activeDocument)) return;
      this.isScanning = false;
      this.scanProgress = null;
      console.error('Document search failed:', error);
      this.status.textContent = 'Search unavailable';
      this.setNavigationEnabled(false);
      return;
    }
    if (!this.isCurrentSearch(epoch, activeDocument)) return;

    this.isScanning = false;
    this.scanProgress = null;
    this.matches = matches;
    activeDocument.rendering.setSearchQuery(query);
    this.setNavigationEnabled(matches.length > 0);
    if (matches.length === 0) {
      this.status.textContent = 'No matches';
      return;
    }

    if (this.activeIndex < 0) {
      this.activeIndex = 0;
      await this.queueReveal(epoch, activeDocument, matches[0]);
    }
    if (!this.isCurrentSearch(epoch, activeDocument)) return;
    this.updateStatus();
  }

  private isSameDocument(
    left: ActiveSearchDocument | null,
    right: ActiveSearchDocument | null,
  ): boolean {
    return Boolean(
      left &&
        right &&
        left.rendering === right.rendering &&
        left.query.filePath === right.query.filePath &&
        left.query.generation === right.query.generation,
    );
  }

  private isCurrentSearch(epoch: number, activeDocument: ActiveSearchDocument): boolean {
    return (
      epoch === this.searchEpoch &&
      activeDocument.query.isCurrent() &&
      this.isSameDocument(activeDocument, this.getActiveDocument())
    );
  }

  private invalidateSearch(): number {
    this.searchEpoch += 1;
    this.searchedDocument?.rendering.clearSearch();
    this.searchedDocument = null;
    this.matches = [];
    this.activeIndex = -1;
    this.isScanning = false;
    this.scanProgress = null;
    this.revealRequest += 1;
    return this.searchEpoch;
  }

  /** Applies partial results emitted while pages are still being scanned. */
  private handleSearchProgress(
    epoch: number,
    activeDocument: ActiveSearchDocument,
    query: string,
    progress: SearchProgress,
  ): void {
    if (!this.isCurrentSearch(epoch, activeDocument)) return;

    this.scanProgress = { pageNumber: progress.pageNumber, totalPages: progress.totalPages };
    this.matches = progress.matches;
    activeDocument.rendering.setSearchQuery(query);
    if (this.matches.length > 0) {
      this.setNavigationEnabled(true);
    }
    this.updateStatus();
  }

  private async move(direction: -1 | 1): Promise<void> {
    if (this.matches.length === 0) {
      if (this.isScanning) return;
      await this.runSearch();
      return;
    }

    this.activeIndex =
      this.activeIndex < 0
        ? direction === 1
          ? 0
          : this.matches.length - 1
        : (this.activeIndex + direction + this.matches.length) % this.matches.length;
    const activeDocument = this.getActiveDocument();
    if (!activeDocument) return;
    const epoch = this.searchEpoch;
    await this.queueReveal(epoch, activeDocument, this.matches[this.activeIndex]);
  }

  private async queueReveal(
    epoch: number,
    activeDocument: ActiveSearchDocument,
    match: PdfSearchMatch,
  ): Promise<void> {
    const request = ++this.revealRequest;
    const pendingReveal = this.revealQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrentSearch(epoch, activeDocument)) return;
        await activeDocument.rendering.revealSearchMatch(match);
        if (!this.isCurrentSearch(epoch, activeDocument) || request !== this.revealRequest) return;
        this.updateStatus();
      });
    this.revealQueue = pendingReveal;
    await pendingReveal;
  }

  private updateStatus(): void {
    const scanSuffix = this.scanProgress
      ? ` · scanning ${this.scanProgress.pageNumber}/${this.scanProgress.totalPages}`
      : '';
    if (this.activeIndex < 0) {
      if (this.matches.length === 0 && !this.scanProgress) {
        this.status.textContent = 'No matches';
        return;
      }
      const matchLabel = this.matches.length === 1 ? 'match' : 'matches';
      this.status.textContent = `${this.matches.length} ${matchLabel}${scanSuffix}`;
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
