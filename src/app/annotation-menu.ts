// The annotation menu: a small popover beneath the Annotation selected on the
// page. It replaces EmbedPDF's ready-made annotation selection menu and comment
// panel (ADR 0003) with the edits ADR 0002 verified: the Annotation's note (its
// Contents), the colour of a text markup, and Delete. Delete and Backspace also
// delete the selection while focus is not in a text field.

import { isEditableTarget } from '../lib/editable-target';
import type { DocumentAnnotationKind } from '../reader/document-queries';
import type { AnnotationEdit } from '../reader/native-pdf-editing';
import { type ReaderAction, readerAction } from '../reader/reader-actions';
import { hydrateChromeIcons } from './chrome-icons';
import type { DocumentSelectedAnnotation } from './document-workspace';
import { HIGHLIGHT_COLORS } from './markup-tools';

/** Gap between the Annotation and the menu beneath it, in CSS pixels. */
const MENU_OFFSET = 8;

const TEXT_MARKUP_KINDS: ReadonlySet<DocumentAnnotationKind> = new Set([
  'highlight',
  'underline',
  'strikeout',
]);

export interface AnnotationMenuOptions {
  readonly element: HTMLElement;
  /** The active Document's selected Annotation; null when none or editing is unavailable. */
  readonly selectedAnnotation: () => DocumentSelectedAnnotation | null;
  /** Edits go out as Reader Actions naming the Document the Annotation was selected in. */
  readonly dispatchReaderAction: (action: ReaderAction) => unknown;
}

export interface AnnotationMenu {
  /** Re-reads the selection; call on Reading Session and rendering changes. */
  refresh(): void;
  destroy(): void;
}

export function createAnnotationMenu({
  element,
  selectedAnnotation,
  dispatchReaderAction,
}: AnnotationMenuOptions): AnnotationMenu {
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Annotation');

  let shown: {
    filePath: string;
    id: string;
    field: HTMLTextAreaElement;
    committed: string;
  } | null = null;
  let swatches: HTMLButtonElement[] = [];

  const edit = (annotation: { filePath: string; id: string }, change: AnnotationEdit) =>
    dispatchReaderAction(readerAction.editAnnotation(annotation.filePath, annotation.id, change));

  const commitNote = () => {
    if (!shown || shown.field.value === shown.committed) return;
    shown.committed = shown.field.value;
    edit(shown, { type: 'contents', contents: shown.field.value });
  };

  const build = (annotation: DocumentSelectedAnnotation) => {
    const field = document.createElement('textarea');
    field.className = 'annotation-menu-note';
    field.rows = 3;
    field.placeholder = 'Add a note';
    field.setAttribute('aria-label', 'Note');
    field.value = annotation.contents;
    field.addEventListener('change', commitNote);

    swatches = TEXT_MARKUP_KINDS.has(annotation.kind)
      ? HIGHLIGHT_COLORS.map((color) => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.className = 'annotation-menu-swatch highlight-swatch';
          swatch.setAttribute('role', 'radio');
          swatch.setAttribute('aria-label', color.label);
          swatch.dataset.strokeColor = color.strokeColor;
          swatch.style.setProperty('--highlight-color', color.strokeColor);
          swatch.addEventListener('click', () =>
            edit(annotation, { type: 'color', strokeColor: color.strokeColor }),
          );
          return swatch;
        })
      : [];
    const colours = document.createElement('div');
    colours.className = 'annotation-menu-colors';
    colours.setAttribute('role', 'radiogroup');
    colours.setAttribute('aria-label', 'Colour');
    colours.hidden = swatches.length === 0;
    colours.append(...swatches);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'toolbar-btn annotation-menu-delete';
    remove.setAttribute('aria-label', 'Delete');
    remove.title = 'Delete';
    remove.dataset.icon = 'trash';
    remove.addEventListener('click', () => edit(annotation, { type: 'delete' }));

    const actions = document.createElement('div');
    actions.className = 'annotation-menu-actions';
    actions.append(colours, remove);
    element.replaceChildren(field, actions);
    hydrateChromeIcons(element);
    shown = {
      filePath: annotation.filePath,
      id: annotation.id,
      field,
      committed: annotation.contents,
    };
    return field;
  };

  const hide = () => {
    commitNote();
    shown = null;
    swatches = [];
    element.hidden = true;
    element.replaceChildren();
  };

  const refresh = () => {
    const annotation = selectedAnnotation();
    if (!annotation) {
      hide();
      return;
    }
    if (shown?.id !== annotation.id || shown.filePath !== annotation.filePath) {
      commitNote();
      const field = build(annotation);
      // A new, empty note is placed to be written: take the typing at once, or,
      // when a click placed it, once that click is over (the page takes focus on it).
      if (annotation.kind === 'note' && !annotation.contents && annotation.anchor) {
        if (pointerDown) focusAfterPointer = field;
        else field.focus();
      }
    } else if (document.activeElement !== shown.field) {
      shown.field.value = annotation.contents;
      shown.committed = annotation.contents;
    }
    const color = annotation.color?.toLowerCase();
    for (const swatch of swatches) {
      swatch.setAttribute(
        'aria-checked',
        String(swatch.dataset.strokeColor?.toLowerCase() === color),
      );
    }
    element.hidden = !annotation.anchor;
    if (annotation.anchor) {
      const { left, top, height } = annotation.anchor;
      element.style.left = `${Math.round(left + MENU_OFFSET + 4)}px`;
      element.style.top = `${Math.round(top + height + MENU_OFFSET)}px`;
    }
  };

  let pointerDown = false;
  let focusAfterPointer: HTMLTextAreaElement | null = null;
  const onPointerDown = () => {
    pointerDown = true;
  };
  const onPointerUp = () => {
    pointerDown = false;
    const field = focusAfterPointer;
    focusAfterPointer = null;
    if (field) setTimeout(() => field.isConnected && field.focus(), 0);
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (isEditableTarget(document.activeElement)) return;
    const annotation = selectedAnnotation();
    if (!annotation) return;
    event.preventDefault();
    edit(annotation, { type: 'delete' });
  };
  document.addEventListener('keydown', onKeyDown);

  return {
    refresh,
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      hide();
    },
  };
}
