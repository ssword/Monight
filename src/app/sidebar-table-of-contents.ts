// Table of Contents sidebar mode: the active Document's outline from Document
// Queries, rendered as a tree. Activating an entry dispatches the Reader Action
// for its target so it is recorded like any other jump.

import type { PdfOutlineItem } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type { SidebarDocument, SidebarModeContext, SidebarModeView } from './reader-sidebar';

export function createTableOfContentsView({
  dispatchReaderAction,
}: SidebarModeContext): SidebarModeView {
  const element = document.createElement('div');
  element.className = 'sidebar-outline';
  let shown: { filePath: string; generation: number | undefined } | null = null;
  let request = 0;
  const targets = new WeakMap<Element, PdfLinkTarget>();

  const setExpanded = (node: HTMLElement, expanded: boolean) => {
    const group = node.querySelector<HTMLElement>(':scope > [role="group"]');
    if (!group) return;
    node.setAttribute('aria-expanded', String(expanded));
    group.hidden = !expanded;
  };

  const renderEntries = (items: readonly PdfOutlineItem[], level: number): HTMLElement[] =>
    items.map((item) => {
      const node = document.createElement('li');
      node.setAttribute('role', 'treeitem');
      node.setAttribute('aria-level', String(level));
      const row = document.createElement('div');
      row.className = 'sidebar-outline-row';
      row.style.setProperty('--sidebar-outline-level', String(level - 1));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-outline-link';
      const title = document.createElement('span');
      title.className = 'sidebar-outline-title';
      title.textContent = item.title;
      button.title = item.title;
      button.append(title);
      if (item.target) targets.set(button, item.target);
      else button.disabled = true;
      if (item.items.length > 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sidebar-outline-disclosure';
        toggle.tabIndex = -1;
        toggle.setAttribute('aria-label', `Show or hide entries in ${item.title}`);
        row.append(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'sidebar-outline-spacer';
        row.append(spacer);
      }
      row.append(button);
      node.append(row);
      if (item.items.length > 0) {
        const group = document.createElement('ul');
        group.setAttribute('role', 'group');
        group.append(...renderEntries(item.items, level + 1));
        node.append(group);
        setExpanded(node, false);
      }
      return node;
    });

  element.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest('.sidebar-outline-disclosure');
    const node = toggle?.closest<HTMLElement>('[role="treeitem"]');
    if (node) {
      setExpanded(node, node.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const link = target?.closest('.sidebar-outline-link');
    const linkTarget = link ? targets.get(link) : undefined;
    if (!shown || !linkTarget) return;
    void dispatchReaderAction({
      type: 'activateDocumentTarget',
      filePath: shown.filePath,
      target: linkTarget,
    });
  });

  element.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest<HTMLElement>('[role="treeitem"]');
    if (!node?.hasAttribute('aria-expanded')) return;
    event.preventDefault();
    setExpanded(node, event.key === 'ArrowRight');
  });

  const showEmpty = (message: string) => {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty-state';
    empty.textContent = message;
    element.replaceChildren(empty);
  };

  const show = (items: readonly PdfOutlineItem[]) => {
    if (items.length === 0) {
      showEmpty('No Table of Contents');
      return;
    }
    const tree = document.createElement('ul');
    tree.className = 'sidebar-outline-tree';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Table of Contents');
    tree.append(...renderEntries(items, 1));
    element.replaceChildren(tree);
  };

  const load = (sidebarDocument: SidebarDocument) => {
    const current = ++request;
    element.replaceChildren();
    const { query } = sidebarDocument;
    if (!query) return;
    void query
      .outline()
      .then((items) => {
        if (current === request && query.isCurrent()) show(items);
      })
      .catch((error: unknown) => {
        if (current !== request) return;
        console.error('Table of Contents failed:', error);
        showEmpty('No Table of Contents');
      });
  };

  return {
    element,
    update(sidebarDocument) {
      if (!sidebarDocument) {
        shown = null;
        request += 1;
        showEmpty('No Document');
        return;
      }
      const { filePath, query } = sidebarDocument;
      if (shown?.filePath === filePath && shown.generation === query?.generation) return;
      shown = { filePath, generation: query?.generation };
      load(sidebarDocument);
    },
    destroy() {
      request += 1;
      element.replaceChildren();
    },
  };
}
