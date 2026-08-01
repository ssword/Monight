import type { PdfAnnotation, PdfOutlineItem } from '../lib/document-features';
import type { PDFViewer } from '../scripts/pdf-viewer';

type SidebarPanel = 'outline' | 'thumbnails' | 'annotations';

interface SidebarControllerOptions {
  getActiveViewer: () => PDFViewer | null;
  requestAnnotationNote: (initialValue?: string) => Promise<string | null>;
}

export class SidebarController {
  private readonly getActiveViewer: () => PDFViewer | null;
  private readonly requestAnnotationNote: (initialValue?: string) => Promise<string | null>;
  private readonly sidebar: HTMLElement;
  private readonly content: HTMLElement;
  private panel: SidebarPanel = 'outline';
  private thumbnailsEnabled = true;
  private renderEpoch = 0;
  private thumbnailObserver: IntersectionObserver | null = null;

  constructor(options: SidebarControllerOptions) {
    this.getActiveViewer = options.getActiveViewer;
    this.requestAnnotationNote = options.requestAnnotationNote;
    this.sidebar = this.requireElement('document-sidebar');
    this.content = this.requireElement('sidebar-content');

    document.querySelectorAll<HTMLButtonElement>('[data-sidebar-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = button.dataset.sidebarTab as SidebarPanel | undefined;
        if (panel) this.open(panel);
      });
    });
    this.requireElement('close-sidebar').addEventListener('click', () => this.close());
    this.requireElement('toggle-outline').addEventListener('click', () => this.toggle('outline'));
    this.requireElement('toggle-thumbnails').addEventListener('click', () =>
      this.toggle('thumbnails'),
    );
    this.requireElement('toggle-annotations').addEventListener('click', () =>
      this.toggle('annotations'),
    );
    this.updateTabState();
  }

  private requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Sidebar control '${id}' not found`);
    return element;
  }

  setThumbnailsEnabled(enabled: boolean): void {
    this.thumbnailsEnabled = enabled;
    this.requireElement('toggle-thumbnails').classList.toggle('hidden', !enabled);
    this.requireElement('thumbnails-tab').classList.toggle('hidden', !enabled);
    if (!enabled && this.panel === 'thumbnails') {
      this.panel = 'outline';
      if (!this.sidebar.classList.contains('hidden')) void this.render();
    }
    this.updateTabState();
  }

  activeDocumentChanged(): void {
    this.renderEpoch += 1;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    if (!this.sidebar.classList.contains('hidden')) {
      void this.render();
    }
  }

  viewerStateChanged(): void {
    const state = this.getActiveViewer()?.getState();
    if (!state) return;
    this.content.querySelectorAll<HTMLElement>('[data-page-number]').forEach((element) => {
      element.classList.toggle(
        'active',
        Number.parseInt(element.dataset.pageNumber ?? '0', 10) === state.currentPage,
      );
    });
    if (this.panel === 'annotations') {
      this.renderAnnotations();
    }
  }

  annotationsChanged(): void {
    if (this.panel === 'annotations' && !this.sidebar.classList.contains('hidden')) {
      this.renderAnnotations();
    }
  }

  open(panel: SidebarPanel): void {
    if (panel === 'thumbnails' && !this.thumbnailsEnabled) return;
    this.panel = panel;
    this.sidebar.classList.remove('hidden');
    this.updateTabState();
    void this.render();
  }

  close(): void {
    this.sidebar.classList.add('hidden');
    this.renderEpoch += 1;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
  }

  private toggle(panel: SidebarPanel): void {
    if (!this.sidebar.classList.contains('hidden') && this.panel === panel) {
      this.close();
      return;
    }
    this.open(panel);
  }

  private updateTabState(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-sidebar-tab]').forEach((button) => {
      const selected = button.dataset.sidebarTab === this.panel;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  }

  private async render(): Promise<void> {
    const viewer = this.getActiveViewer();
    const epoch = ++this.renderEpoch;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;

    if (!viewer) {
      this.renderEmpty('Open a PDF to use the document sidebar.');
      return;
    }

    switch (this.panel) {
      case 'outline':
        await this.renderOutline(viewer, epoch);
        break;
      case 'thumbnails':
        this.renderThumbnails(viewer, epoch);
        break;
      case 'annotations':
        this.renderAnnotations();
        break;
    }
  }

  private async renderOutline(viewer: PDFViewer, epoch: number): Promise<void> {
    this.content.replaceChildren(this.message('Loading table of contents…', 'sidebar-loading'));
    let outline: PdfOutlineItem[];
    try {
      outline = await viewer.getOutlineItems();
    } catch (error) {
      console.error('Failed to load PDF outline:', error);
      if (epoch === this.renderEpoch) {
        this.renderEmpty('The table of contents could not be loaded.');
      }
      return;
    }
    if (epoch !== this.renderEpoch || viewer !== this.getActiveViewer()) return;
    if (outline.length === 0) {
      this.renderEmpty('This PDF does not contain a table of contents.');
      return;
    }

    const list = document.createElement('ul');
    list.className = 'outline-list';
    this.appendOutlineItems(list, outline, viewer);
    this.content.replaceChildren(list);
  }

  private appendOutlineItems(
    parent: HTMLUListElement,
    items: PdfOutlineItem[],
    viewer: PDFViewer,
  ): void {
    for (const item of items) {
      const listItem = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item-button';
      button.textContent = item.title;
      button.title = item.title;
      button.style.fontWeight = item.bold ? '700' : '400';
      button.style.fontStyle = item.italic ? 'italic' : 'normal';
      button.disabled = item.pageNumber === null && !item.url;
      if (item.pageNumber !== null) button.dataset.pageNumber = item.pageNumber.toString();
      button.addEventListener('click', async () => {
        await viewer.activateOutlineItem(item);
        this.viewerStateChanged();
      });
      listItem.appendChild(button);

      if (item.items.length > 0) {
        const childList = document.createElement('ul');
        this.appendOutlineItems(childList, item.items, viewer);
        listItem.appendChild(childList);
      }
      parent.appendChild(listItem);
    }
  }

  private renderThumbnails(viewer: PDFViewer, epoch: number): void {
    const list = document.createElement('div');
    list.className = 'thumbnail-list';
    const { totalPages, currentPage } = viewer.getState();

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumbnail-button';
      button.dataset.pageNumber = pageNumber.toString();
      button.classList.toggle('active', pageNumber === currentPage);

      const preview = document.createElement('div');
      preview.className = 'thumbnail-preview';
      preview.textContent = 'Loading…';
      const label = document.createElement('span');
      label.textContent = `Page ${pageNumber}`;
      button.append(preview, label);
      button.addEventListener('click', async () => {
        await viewer.goToPage(pageNumber);
        this.viewerStateChanged();
      });
      list.appendChild(button);
    }

    this.content.replaceChildren(list);
    const loadPreview = (button: HTMLButtonElement) => {
      const pageNumber = Number.parseInt(button.dataset.pageNumber ?? '0', 10);
      const preview = button.querySelector<HTMLElement>('.thumbnail-preview');
      if (!preview || pageNumber < 1 || preview.dataset.loaded === 'true') return;
      preview.dataset.loaded = 'true';
      void viewer
        .renderThumbnail(pageNumber)
        .then((canvas) => {
          if (epoch !== this.renderEpoch || viewer !== this.getActiveViewer()) return;
          preview.replaceChildren(canvas);
        })
        .catch(() => {
          preview.textContent = 'Preview unavailable';
        });
    };

    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('.thumbnail-button'));
    if ('IntersectionObserver' in window) {
      this.thumbnailObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const button = entry.target as HTMLButtonElement;
            this.thumbnailObserver?.unobserve(button);
            loadPreview(button);
          }
        },
        { root: this.content, rootMargin: '220px' },
      );
      buttons.forEach((button) => {
        this.thumbnailObserver?.observe(button);
      });
    } else {
      buttons.slice(0, 8).forEach(loadPreview);
    }
  }

  private renderAnnotations(): void {
    const viewer = this.getActiveViewer();
    if (!viewer) {
      this.renderEmpty('Open a PDF to add annotations.');
      return;
    }

    const container = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.className = 'annotation-toolbar';
    const addNote = document.createElement('button');
    addNote.type = 'button';
    addNote.className = 'annotation-add';
    addNote.textContent = `Add note to page ${viewer.getState().currentPage}`;
    addNote.addEventListener('click', async () => {
      const note = await this.requestAnnotationNote();
      if (note) {
        await viewer.addPageNote(note);
        this.renderAnnotations();
      }
    });
    toolbar.appendChild(addNote);
    container.appendChild(toolbar);

    const annotations = viewer
      .getAnnotations()
      .sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt - b.createdAt);
    if (annotations.length === 0) {
      container.appendChild(
        this.message(
          'Select text and right-click to highlight it, or add a note to the current page.',
          'sidebar-empty',
        ),
      );
    } else {
      annotations.forEach((annotation) => {
        container.appendChild(this.createAnnotationCard(annotation, viewer));
      });
    }
    this.content.replaceChildren(container);
  }

  private createAnnotationCard(annotation: PdfAnnotation, viewer: PDFViewer): HTMLElement {
    const card = document.createElement('article');
    card.className = 'annotation-card';
    card.dataset.color = annotation.color;
    card.dataset.annotationId = annotation.id;

    const header = document.createElement('div');
    header.className = 'annotation-card-header';
    const pageButton = document.createElement('button');
    pageButton.type = 'button';
    pageButton.textContent = `Page ${annotation.pageNumber}`;
    pageButton.addEventListener('click', () => void viewer.goToPage(annotation.pageNumber));
    const kind = document.createElement('span');
    kind.textContent = annotation.kind === 'highlight' ? 'Highlight' : 'Note';
    header.append(pageButton, kind);
    card.appendChild(header);

    if (annotation.text) {
      const quote = document.createElement('blockquote');
      quote.textContent = annotation.text;
      card.appendChild(quote);
    }

    const note = document.createElement('textarea');
    note.value = annotation.note;
    note.placeholder = 'Add a note…';
    note.setAttribute('aria-label', `Note for annotation on page ${annotation.pageNumber}`);
    note.addEventListener('input', () => {
      viewer.updateAnnotation(annotation.id, { note: note.value.trim() });
    });
    card.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'annotation-card-actions';
    const color = document.createElement('select');
    color.setAttribute('aria-label', 'Highlight color');
    for (const value of ['yellow', 'green', 'blue', 'pink'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      option.selected = annotation.color === value;
      color.appendChild(option);
    }
    color.addEventListener('change', () => {
      viewer.updateAnnotation(annotation.id, {
        color: color.value as PdfAnnotation['color'],
      });
      card.dataset.color = color.value;
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      viewer.removeAnnotation(annotation.id);
      this.renderAnnotations();
    });
    actions.append(color, remove);
    card.appendChild(actions);
    return card;
  }

  private renderEmpty(text: string): void {
    this.content.replaceChildren(this.message(text, 'sidebar-empty'));
  }

  private message(text: string, className: string): HTMLElement {
    const message = document.createElement('p');
    message.className = className;
    message.textContent = text;
    return message;
  }
}
