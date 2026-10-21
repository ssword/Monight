// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import type { ActiveMarkupState } from '../app/document-workspace';
import { createMarkupToolbar, leaveMarkupToolOnEscape } from '../app/markup-toolbar';
import { VERIFIED_MARKUP_TOOLS, type VerifiedMarkupTool } from '../app/markup-tools';

function createStorage(initial?: unknown): ChromePreferencesStorage {
  let stored = structuredClone(initial);
  return {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
}

const PROTECTED = 'PDF permissions prohibit annotation editing; this Document is read-only';

describe('markup toolbar', () => {
  let preferences: ChromePreferencesAuthority;
  let active: ActiveMarkupState | null;
  let chosen: Array<string | null>;

  const bar = () => document.getElementById('markup-toolbar') as HTMLElement;
  const toggle = () => document.getElementById('markup-toolbar-toggle') as HTMLButtonElement;
  const toolButtons = () => [...bar().querySelectorAll<HTMLButtonElement>('[data-markup-tool]')];

  const mount = async (
    storage: ChromePreferencesStorage = createStorage(),
    tools?: readonly VerifiedMarkupTool[],
  ) => {
    preferences = await loadChromePreferences(storage, { debounceMs: 0 });
    return createMarkupToolbar({
      elements: { bar: bar(), toggle: toggle() },
      preferences,
      ...(tools ? { tools } : {}),
      activeMarkup: () => active,
      setActiveTool: (toolId) => {
        chosen.push(toolId);
        if (active) active = { ...active, activeToolId: toolId };
      },
    });
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toolbar">
        <button id="markup-toolbar-toggle" type="button" aria-pressed="false"></button>
      </div>
      <div id="markup-toolbar" role="toolbar" hidden></div>
    `;
    active = { activeToolId: null, readOnlyReason: null };
    chosen = [];
  });

  it('shows and hides from the toolbar toggle and remembers it across relaunches', async () => {
    const storage = createStorage();
    const firstLaunch = await mount(storage);
    expect(bar().hidden).toBe(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');

    toggle().click();
    expect(bar().hidden).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    await preferences.flush();
    firstLaunch.destroy();

    await mount(storage);
    expect(bar().hidden).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('offers only the verified markup-toolbar tools: Text Note', async () => {
    await mount();

    expect(toolButtons().map((button) => button.dataset.markupTool)).toEqual(['textComment']);
    expect(toolButtons()[0]?.getAttribute('aria-label')).toBe('Text Note');
    expect(bar().querySelector('[data-markup-tool="highlight"]')).toBeNull();
  });

  it('shows a newly verified tool from the list alone', async () => {
    const shapes: VerifiedMarkupTool = {
      id: 'square',
      label: 'Rectangle',
      icon: 'sticky-note',
      control: 'markup-toolbar',
      verification: ['docs/example.md'],
    };
    await mount(createStorage(), [...VERIFIED_MARKUP_TOOLS, shapes]);

    expect(toolButtons().map((button) => button.dataset.markupTool)).toEqual([
      'textComment',
      'square',
    ]);
  });

  it('chooses the Text Note tool and returns to text selection on a second click', async () => {
    const toolbar = await mount(createStorage({ schemaVersion: 1, markupToolbarVisible: true }));
    const [textNote] = toolButtons();

    textNote?.click();
    toolbar.refresh();
    expect(chosen).toEqual(['textComment']);
    expect(textNote?.getAttribute('aria-pressed')).toBe('true');

    textNote?.click();
    toolbar.refresh();
    expect(chosen).toEqual(['textComment', null]);
    expect(textNote?.getAttribute('aria-pressed')).toBe('false');
  });

  it('returns to text selection when hidden with a markup tool chosen', async () => {
    active = { activeToolId: 'textComment', readOnlyReason: null };
    await mount(createStorage({ schemaVersion: 1, markupToolbarVisible: true }));

    toggle().click();

    expect(bar().hidden).toBe(true);
    expect(chosen).toEqual([null]);
  });

  it('offers its tools to other input adapters such as Tools ▸ Annotate', async () => {
    const toolbar = await mount();

    toolbar.chooseTool('textComment');
    toolbar.chooseTool('textComment');
    toolbar.chooseTool('highlight');

    expect(chosen).toEqual(['textComment', null]);

    active = { activeToolId: null, readOnlyReason: PROTECTED };
    toolbar.chooseTool('textComment');
    expect(chosen).toEqual(['textComment', null]);
  });

  it('offers the toggle to other input adapters such as the View menu', async () => {
    active = { activeToolId: 'textComment', readOnlyReason: null };
    const toolbar = await mount(createStorage({ schemaVersion: 1, markupToolbarVisible: true }));

    toolbar.toggle();
    expect(bar().hidden).toBe(true);
    expect(preferences.snapshot().markupToolbarVisible).toBe(false);
    expect(chosen).toEqual([null]);

    toolbar.toggle();
    expect(bar().hidden).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('makes tools unavailable on a protected Document with its editing explanation', async () => {
    active = { activeToolId: null, readOnlyReason: PROTECTED };
    await mount(createStorage({ schemaVersion: 1, markupToolbarVisible: true }));
    const [textNote] = toolButtons();

    expect(textNote?.disabled).toBe(true);
    expect(textNote?.title).toBe(PROTECTED);
    expect(bar().querySelector('[role="status"]')?.textContent).toBe(PROTECTED);
    textNote?.click();
    expect(chosen).toEqual([]);
  });

  it('follows the active Document when refreshed', async () => {
    const toolbar = await mount(createStorage({ schemaVersion: 1, markupToolbarVisible: true }));
    const [textNote] = toolButtons();
    expect(textNote?.disabled).toBe(false);

    active = { activeToolId: null, readOnlyReason: PROTECTED };
    toolbar.refresh();
    expect(textNote?.disabled).toBe(true);

    active = null;
    toolbar.refresh();
    expect(textNote?.disabled).toBe(true);
    expect(bar().querySelector('[role="status"]')?.textContent).toBe('');
  });
});

describe('Esc leaves the markup tool', () => {
  let active: ActiveMarkupState | null;
  let chosen: Array<string | null>;
  let presenting: boolean;
  let release: () => void;

  const pressEscape = (target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="toolbar-search" type="search">
      <button id="sidebar-mode-toggle" aria-expanded="false"></button>
    `;
    active = { activeToolId: 'highlight', readOnlyReason: null };
    chosen = [];
    presenting = false;
    release = leaveMarkupToolOnEscape({
      activeMarkup: () => active,
      setActiveTool: (toolId) => {
        chosen.push(toolId);
        if (active) active = { ...active, activeToolId: toolId };
      },
      presentationActive: () => presenting,
    });
  });
  afterEach(() => release());

  it('leaves highlight mode and the Text note tool for text selection', () => {
    expect(pressEscape().defaultPrevented).toBe(true);
    expect(chosen).toEqual([null]);

    active = { activeToolId: 'textComment', readOnlyReason: null };
    pressEscape();
    expect(chosen).toEqual([null, null]);
  });

  it('leaves Esc alone when no markup tool is chosen', () => {
    active = { activeToolId: null, readOnlyReason: null };
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(chosen).toEqual([]);
  });

  it('lets presentation mode take Esc first', () => {
    presenting = true;
    pressEscape();
    expect(chosen).toEqual([]);
  });

  it('lets the search field and open menus take Esc first', () => {
    const search = document.getElementById('toolbar-search') as HTMLInputElement;
    pressEscape(search);
    expect(chosen).toEqual([]);

    document.getElementById('sidebar-mode-toggle')?.setAttribute('aria-expanded', 'true');
    pressEscape();
    expect(chosen).toEqual([]);
  });
});
