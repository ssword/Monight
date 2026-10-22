// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AnnotationMenu, createAnnotationMenu } from '../app/annotation-menu';
import type { DocumentSelectedAnnotation } from '../app/document-workspace';
import { HIGHLIGHT_COLORS } from '../app/markup-tools';
import type { AnnotationEdit } from '../reader/native-pdf-editing';
import type { ReaderAction } from '../reader/reader-actions';

const REPORT = '/docs/report.pdf';

const note = (overrides: Partial<DocumentSelectedAnnotation> = {}): DocumentSelectedAnnotation => ({
  filePath: REPORT,
  id: 'note-1',
  kind: 'note',
  contents: '',
  color: '#FFCD45',
  anchor: { left: 200, top: 120, width: 24, height: 24 },
  ...overrides,
});

const highlight = (
  overrides: Partial<DocumentSelectedAnnotation> = {},
): DocumentSelectedAnnotation =>
  note({ id: 'mark-1', kind: 'highlight', contents: 'Remember this', ...overrides });

describe('Annotation menu', () => {
  let selected: DocumentSelectedAnnotation | null;
  let edits: Array<{ filePath: string; id: string; edit: AnnotationEdit }>;
  let mounted: AnnotationMenu[] = [];

  const menu = () => document.getElementById('annotation-menu') as HTMLElement;
  const field = () => menu().querySelector<HTMLTextAreaElement>('textarea');
  const button = (label: string) =>
    menu().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const swatches = () => Array.from(menu().querySelectorAll<HTMLButtonElement>('[role="radio"]'));

  const mount = () => {
    const view = createAnnotationMenu({
      element: menu(),
      selectedAnnotation: () => selected,
      dispatchReaderAction: (action: ReaderAction) => {
        if (action.type !== 'editAnnotation') throw new Error(`Unexpected ${action.type}`);
        const { filePath, annotationId: id, edit } = action;
        edits.push({ filePath, id, edit });
        if (selected?.filePath !== filePath) return;
        if (edit.type === 'delete') selected = null;
        else if (selected?.id === id && edit.type === 'contents')
          selected = { ...selected, contents: edit.contents };
        else if (selected?.id === id && edit.type === 'color')
          selected = { ...selected, color: edit.strokeColor };
      },
    });
    mounted.push(view);
    return view;
  };

  afterEach(() => {
    for (const view of mounted) view.destroy();
    mounted = [];
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="toolbar-search" />
      <div id="annotation-menu" hidden></div>
    `;
    selected = null;
    edits = [];
  });

  it('stays hidden while no Annotation is selected', () => {
    mount().refresh();

    expect(menu().hidden).toBe(true);
  });

  it('opens beside a selected Annotation with its note, and Delete', () => {
    selected = highlight();
    mount().refresh();

    expect(menu().hidden).toBe(false);
    expect(field()?.value).toBe('Remember this');
    expect(field()?.getAttribute('aria-label')).toBe('Note');
    expect(button('Delete')).not.toBeNull();
    // Just below the Annotation, like the selection menu it replaces.
    expect(menu().style.left).toBe('212px');
    expect(menu().style.top).toBe('152px');
  });

  it('writes the note into the Annotation when the field is committed', () => {
    selected = note();
    mount().refresh();

    const input = field() as HTMLTextAreaElement;
    input.value = 'Ask about the moon';
    input.dispatchEvent(new Event('change'));

    expect(edits).toEqual([
      {
        filePath: REPORT,
        id: 'note-1',
        edit: { type: 'contents', contents: 'Ask about the moon' },
      },
    ]);
  });

  it('keeps an uncommitted note when the selection moves on', () => {
    selected = note();
    const view = mount();
    view.refresh();
    (field() as HTMLTextAreaElement).value = 'Typed but not committed';

    selected = highlight();
    view.refresh();

    expect(edits).toEqual([
      {
        filePath: REPORT,
        id: 'note-1',
        edit: { type: 'contents', contents: 'Typed but not committed' },
      },
    ]);
    expect(field()?.value).toBe('Remember this');
  });

  it('focuses the note of a new, empty text note so it can be typed at once', () => {
    selected = note();
    mount().refresh();

    expect(document.activeElement).toBe(field());
  });

  it('focuses a note placed by a click once that click is released', async () => {
    selected = null;
    const view = mount();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    selected = note();
    view.refresh();
    document.body.focus();
    expect(document.activeElement).not.toBe(field());

    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(field());
  });

  it('recolours text markups with the highlight colours, but not notes', () => {
    selected = highlight({ color: '#FFCD45' });
    const view = mount();
    view.refresh();

    expect(swatches().map((swatch) => swatch.getAttribute('aria-label'))).toEqual(
      HIGHLIGHT_COLORS.map(({ label }) => label),
    );
    expect(swatches()[0]?.getAttribute('aria-checked')).toBe('true');

    swatches()[2]?.click();

    expect(edits).toEqual([
      {
        filePath: REPORT,
        id: 'mark-1',
        edit: { type: 'color', strokeColor: HIGHLIGHT_COLORS[2].strokeColor },
      },
    ]);
    view.refresh();
    expect(swatches()[2]?.getAttribute('aria-checked')).toBe('true');

    selected = note();
    view.refresh();
    expect(swatches()).toEqual([]);
  });

  it('deletes the selected Annotation from its Delete button', () => {
    selected = highlight();
    const view = mount();
    view.refresh();

    button('Delete')?.click();
    view.refresh();

    expect(edits).toEqual([{ filePath: REPORT, id: 'mark-1', edit: { type: 'delete' } }]);
    expect(menu().hidden).toBe(true);
  });

  it('deletes the selected Annotation with Delete or Backspace, but not while typing', () => {
    selected = highlight();
    const view = mount();
    view.refresh();

    field()?.focus();
    field()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    document
      .getElementById('toolbar-search')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(edits).toEqual([]);

    field()?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(edits).toEqual([{ filePath: REPORT, id: 'mark-1', edit: { type: 'delete' } }]);
  });

  it('hides while its Annotation is scrolled out of view', () => {
    selected = highlight({ anchor: null });
    mount().refresh();

    expect(menu().hidden).toBe(true);
  });

  it('stops listening once destroyed', () => {
    selected = highlight();
    const view = mount();
    view.refresh();
    view.destroy();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(edits).toEqual([]);
    expect(menu().hidden).toBe(true);
  });
});
