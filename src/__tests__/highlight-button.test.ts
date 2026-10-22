// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import type { ActiveMarkupState } from '../app/document-workspace';
import { createHighlightButton } from '../app/highlight-button';

function createStorage(initial?: unknown): ChromePreferencesStorage {
  let stored = structuredClone(initial);
  return {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
}

const YELLOW = '#FFCD45';

describe('Highlight split button', () => {
  let preferences: ChromePreferencesAuthority;
  let active: ActiveMarkupState | null;
  let selectedText: boolean;
  let marked: Array<{ toolId: string; strokeColor: string }>;
  let chosen: Array<{ toolId: string | null; strokeColor?: string }>;

  const button = () => document.getElementById('highlight') as HTMLButtonElement;

  const mount = async (storage: ChromePreferencesStorage = createStorage()) => {
    preferences = await loadChromePreferences(storage, { debounceMs: 0 });
    return createHighlightButton({
      elements: {
        button: button(),
        menuToggle: document.getElementById('highlight-menu-toggle') as HTMLButtonElement,
        menu: document.getElementById('highlight-menu') as HTMLElement,
      },
      preferences,
      activeMarkup: () => active,
      setActiveTool: (toolId, defaults) => {
        chosen.push({ toolId, ...(defaults ?? {}) });
        if (active) active = { ...active, activeToolId: toolId };
      },
      markupSelection: (toolId, { strokeColor }) => {
        if (!selectedText) return false;
        marked.push({ toolId, strokeColor });
        selectedText = false;
        return true;
      },
    });
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toolbar">
        <button id="highlight" type="button"></button>
        <button id="highlight-menu-toggle" type="button" aria-expanded="false"></button>
        <div id="highlight-menu" role="menu" hidden></div>
      </div>
    `;
    active = { activeToolId: null, readOnlyReason: null };
    selectedText = false;
    marked = [];
    chosen = [];
  });

  it('marks selected text with the first verified subtype in the current colour', async () => {
    await mount();
    selectedText = true;

    button().click();

    expect(marked).toEqual([{ toolId: 'underline', strokeColor: YELLOW }]);
    expect(chosen).toEqual([]);
  });

  it('enters the first verified markup mode and leaves it on a second click', async () => {
    const highlight = await mount();

    button().click();
    highlight.refresh();
    expect(chosen).toEqual([{ toolId: 'underline', strokeColor: YELLOW }]);
    expect(button().getAttribute('aria-pressed')).toBe('true');

    selectedText = true;
    button().click();
    highlight.refresh();
    expect(marked).toEqual([]);
    expect(chosen[chosen.length - 1]).toEqual({ toolId: null });
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('offers its click to other input adapters such as Tools ▸ Annotate', async () => {
    const highlight = await mount();

    selectedText = true;
    highlight.activate('underline');
    expect(marked).toEqual([{ toolId: 'underline', strokeColor: YELLOW }]);

    highlight.activate('underline');
    expect(chosen).toEqual([{ toolId: 'underline', strokeColor: YELLOW }]);
    expect(button().getAttribute('aria-pressed')).toBe('true');

    highlight.activate('underline');
    expect(chosen[chosen.length - 1]).toEqual({ toolId: null });

    // Unverified or non-text-markup tools are not the button's to choose.
    highlight.activate('textComment');
    highlight.activate('highlight'); // Suspended by #124.
    expect(chosen).toHaveLength(2);
  });

  it('offers the five colours and only verified text-markup subtypes', async () => {
    await mount();
    const menu = document.getElementById('highlight-menu') as HTMLElement;

    expect(
      [...menu.querySelectorAll<HTMLElement>('[data-highlight-color]')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Yellow', 'Green', 'Blue', 'Pink', 'Purple']);
    expect(
      [...menu.querySelectorAll<HTMLElement>('[data-highlight-tool]')].map(
        (item) => item.dataset.highlightTool,
      ),
    ).toEqual(['underline', 'strikeout']);
    expect(menu.textContent).not.toMatch(/Highlight|Squiggly|Text Note/);
    expect(menu.dataset.tauriDragRegion).toBe('false');
  });

  it('shows a newly verified text-markup subtype from the list alone', async () => {
    preferences = await loadChromePreferences(createStorage(), { debounceMs: 0 });
    createHighlightButton({
      elements: {
        button: button(),
        menuToggle: document.getElementById('highlight-menu-toggle') as HTMLButtonElement,
        menu: document.getElementById('highlight-menu') as HTMLElement,
      },
      preferences,
      tools: [
        ...(await import('../app/markup-tools')).VERIFIED_MARKUP_TOOLS,
        {
          id: 'squiggly',
          label: 'Squiggly',
          icon: 'highlighter',
          control: 'highlight-menu',
          verification: ['docs/example.md'],
        },
      ],
      activeMarkup: () => active,
      setActiveTool: () => undefined,
      markupSelection: () => false,
    });

    expect(
      [...document.querySelectorAll<HTMLElement>('[data-highlight-tool]')].map(
        (item) => item.dataset.highlightTool,
      ),
    ).toEqual(['underline', 'strikeout', 'squiggly']);
  });

  it('uses the chosen colour and remembers it across relaunches', async () => {
    const storage = createStorage();
    const firstLaunch = await mount(storage);
    document.getElementById('highlight-menu-toggle')?.click();
    expect(document.getElementById('highlight-menu')?.hidden).toBe(false);

    selectedText = true;
    document.querySelector<HTMLElement>('[data-highlight-color="green"]')?.click();
    expect(document.getElementById('highlight-menu')?.hidden).toBe(true);
    expect(marked).toEqual([{ toolId: 'underline', strokeColor: '#7ED957' }]);
    await preferences.flush();
    firstLaunch.destroy();

    await mount(storage);
    expect(
      document.querySelector('[data-highlight-color="green"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    selectedText = true;
    button().click();
    expect(marked[marked.length - 1]).toEqual({ toolId: 'underline', strokeColor: '#7ED957' });
  });

  it('changes the colour of highlight mode without leaving it', async () => {
    await mount();
    button().click();

    document.querySelector<HTMLElement>('[data-highlight-color="purple"]')?.click();

    expect(chosen[chosen.length - 1]).toEqual({ toolId: 'underline', strokeColor: '#B78CF2' });
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('is unavailable on a protected Document with its editing explanation', async () => {
    const reason = 'PDF permissions prohibit annotation editing; this Document is read-only';
    active = { activeToolId: null, readOnlyReason: reason };
    const highlight = await mount();
    selectedText = true;

    expect(button().disabled).toBe(true);
    expect(button().title).toBe(reason);
    button().click();
    expect(marked).toEqual([]);
    expect(chosen).toEqual([]);

    active = null;
    highlight.refresh();
    expect(button().disabled).toBe(true);
    active = { activeToolId: null, readOnlyReason: null };
    highlight.refresh();
    expect(button().disabled).toBe(false);
  });
});
