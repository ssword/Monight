// Highlights and Notes sidebar mode: the active Document's text-markup and note
// Annotations, by any author, grouped by page. The list is a Document Query
// snapshot re-read on every sidebar refresh (annotation edits refresh it), and
// re-rendered only when the snapshot changes. Activating an entry moves the
// Reading Position through a Reader Action, then selects the Annotation.

import type {
  DocumentAnnotationKind,
  DocumentAnnotationSnapshot,
} from '../reader/document-queries';
import type {
  SidebarDocument,
  SidebarItem,
  SidebarModeContext,
  SidebarModeView,
} from './reader-sidebar';

const KIND_LABELS: Readonly<Record<DocumentAnnotationKind, string>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
  squiggly: 'Squiggly Underline',
  note: 'Note',
};

const formatModified = (modified: string | null): string => {
  if (!modified) return '';
  const date = new Date(modified);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function renderEntry(annotation: DocumentAnnotationSnapshot): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sidebar-annotation';
  button.dataset.annotationId = annotation.id;
  button.dataset.annotationKind = annotation.kind;
  const swatch = document.createElement('span');
  swatch.className = 'sidebar-annotation-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  if (annotation.color) swatch.style.setProperty('--sidebar-annotation-color', annotation.color);
  const body = document.createElement('span');
  body.className = 'sidebar-annotation-body';
  const text = document.createElement('span');
  text.className = 'sidebar-annotation-text';
  text.textContent = annotation.contents.trim() || KIND_LABELS[annotation.kind];
  const meta = document.createElement('span');
  meta.className = 'sidebar-annotation-meta';
  meta.textContent = [annotation.author, formatModified(annotation.modified)]
    .filter(Boolean)
    .join(' · ');
  body.append(text, meta);
  button.append(swatch, body);
  button.setAttribute(
    'aria-label',
    `${KIND_LABELS[annotation.kind]}: ${text.textContent}${annotation.author ? `, ${annotation.author}` : ''}`,
  );
  item.append(button);
  return item;
}

export function createAnnotationsView({
  dispatchReaderAction,
  revealAnnotation,
  itemsChanged,
}: SidebarModeContext): SidebarModeView {
  const element = document.createElement('div');
  element.className = 'sidebar-annotations';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', 'Highlights and Notes');
  let shown: { filePath: string; signature: string } | null = null;
  let latest: SidebarDocument | null = null;
  let entries = new Map<string, DocumentAnnotationSnapshot>();
  // Annotations in the order the list shows them (by page); what Previous/Next Item step through.
  let ordered: DocumentAnnotationSnapshot[] = [];
  let selectedKey: string | null = null;

  const markSelected = () => {
    for (const button of element.querySelectorAll<HTMLElement>('.sidebar-annotation')) {
      if (button.dataset.annotationId === selectedKey) {
        button.dataset.selected = 'true';
        button.scrollIntoView?.({ block: 'nearest' });
      } else {
        delete button.dataset.selected;
      }
    }
  };
  const activate = async (annotation: DocumentAnnotationSnapshot) => {
    if (!shown) return;
    const { filePath } = shown;
    selectedKey = annotation.id;
    markSelected();
    itemsChanged();
    await dispatchReaderAction({
      type: 'activateDocumentTarget',
      filePath,
      target: { readingPosition: { ...annotation.readingPosition } },
    });
    revealAnnotation(filePath, annotation.id);
  };
  let loading = false;
  let reloadRequested = false;
  let destroyed = false;

  const render = (filePath: string, annotations: readonly DocumentAnnotationSnapshot[]) => {
    const signature = JSON.stringify(annotations);
    if (shown?.filePath === filePath && shown.signature === signature) return;
    shown = { filePath, signature };
    entries = new Map(annotations.map((annotation) => [annotation.id, annotation]));
    ordered = [...annotations].sort((left, right) => left.pageNumber - right.pageNumber);
    if (!entries.has(selectedKey ?? '')) selectedKey = null;
    itemsChanged();
    if (annotations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-annotations-empty';
      empty.textContent = 'No Highlights or Notes';
      element.replaceChildren(empty);
      return;
    }
    const pages = new Map<number, DocumentAnnotationSnapshot[]>();
    for (const annotation of annotations) {
      const page = pages.get(annotation.pageNumber) ?? [];
      page.push(annotation);
      pages.set(annotation.pageNumber, page);
    }
    const groups = [...pages.entries()]
      .sort(([left], [right]) => left - right)
      .map(([pageNumber, pageAnnotations]) => {
        const group = document.createElement('section');
        group.className = 'sidebar-annotation-page';
        const heading = document.createElement('h3');
        heading.className = 'sidebar-annotation-page-heading';
        heading.textContent = `Page ${pageNumber}`;
        const list = document.createElement('ul');
        list.className = 'sidebar-annotation-list';
        list.append(...pageAnnotations.map(renderEntry));
        group.append(heading, list);
        return group;
      });
    element.replaceChildren(...groups);
    markSelected();
  };

  const clear = () => {
    shown = null;
    entries = new Map();
    ordered = [];
    selectedKey = null;
    element.replaceChildren();
    itemsChanged();
  };

  const load = async (): Promise<void> => {
    if (loading) {
      reloadRequested = true;
      return;
    }
    loading = true;
    try {
      do {
        reloadRequested = false;
        const sidebarDocument = latest;
        const query = sidebarDocument?.query;
        if (!sidebarDocument || !query) {
          clear();
          continue;
        }
        const annotations = await query.annotations().catch((error: unknown) => {
          console.error('Highlights and Notes failed:', error);
          return null;
        });
        if (destroyed) return;
        if (annotations && latest?.filePath === sidebarDocument.filePath && query.isCurrent()) {
          render(sidebarDocument.filePath, annotations);
        }
      } while (reloadRequested && !destroyed);
    } finally {
      loading = false;
    }
  };

  element.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.sidebar-annotation')
        : null;
    const annotation = entries.get(button?.dataset.annotationId ?? '');
    if (!shown || !annotation) return;
    void activate(annotation);
  });

  return {
    element,
    update(sidebarDocument) {
      latest = sidebarDocument;
      if (!sidebarDocument) {
        clear();
        return;
      }
      void load();
    },
    items: (): SidebarItem[] =>
      ordered.map((annotation) => ({
        key: annotation.id,
        page: annotation.pageNumber,
        activate: () => activate(annotation),
      })),
    selectedItemKey: () => selectedKey,
    destroy() {
      destroyed = true;
      clear();
    },
  };
}
