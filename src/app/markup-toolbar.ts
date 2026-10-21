// Monight's markup toolbar: a strip beneath the toolbar holding the verified
// annotation tools for the markup toolbar (markup-tools.ts), shown and hidden
// by the toolbar's Markup toggle. Visibility is a chrome preference; the chosen
// tool is transient and lives on the active Document's rendering.

import { hydrateChromeIcons } from './chrome-icons';
import type { ChromePreferencesAuthority } from './chrome-preferences';
import type { ActiveMarkupState } from './document-workspace';
import {
  toolAfterChoosing,
  VERIFIED_MARKUP_TOOLS,
  type VerifiedMarkupTool,
  verifiedMarkupTools,
} from './markup-tools';

export interface MarkupToolbarElements {
  readonly bar: HTMLElement;
  readonly toggle: HTMLButtonElement;
}

export interface MarkupToolbarOptions {
  readonly elements: MarkupToolbarElements;
  readonly preferences: ChromePreferencesAuthority;
  /** The verified tools; defaults to VERIFIED_MARKUP_TOOLS. */
  readonly tools?: readonly VerifiedMarkupTool[];
  readonly activeMarkup: () => ActiveMarkupState | null;
  /** Chooses a tool on the active Document, or null for text selection. */
  readonly setActiveTool: (toolId: string | null) => void;
}

export interface MarkupToolbar {
  /** Re-reads the active Document; call on Reading Session and rendering changes. */
  refresh(): void;
  /** Shows or hides the markup toolbar, as the toolbar's Markup toggle does. */
  toggle(): void;
  destroy(): void;
}

export function createMarkupToolbar({
  elements: { bar, toggle },
  preferences,
  tools = VERIFIED_MARKUP_TOOLS,
  activeMarkup,
  setActiveTool,
}: MarkupToolbarOptions): MarkupToolbar {
  const group = document.createElement('div');
  group.className = 'markup-toolbar-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Markup tools');
  const buttons = verifiedMarkupTools('markup-toolbar', tools).map((tool) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-btn markup-tool';
    button.dataset.markupTool = tool.id;
    button.setAttribute('aria-label', tool.label);
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('span');
    icon.className = 'toolbar-icon';
    icon.dataset.icon = tool.icon;
    button.append(icon);
    group.append(button);
    return { tool, button };
  });
  const status = document.createElement('span');
  status.className = 'markup-toolbar-status';
  status.setAttribute('role', 'status');
  bar.replaceChildren(group, status);
  hydrateChromeIcons(group);

  const markupToolIds = new Set(buttons.map(({ tool }) => tool.id));

  const render = () => {
    const visible = preferences.snapshot().markupToolbarVisible;
    bar.hidden = !visible;
    toggle.setAttribute('aria-pressed', String(visible));
    const markup = activeMarkup();
    const reason = markup?.readOnlyReason ?? null;
    for (const { tool, button } of buttons) {
      button.disabled = !markup || reason !== null;
      button.title = reason ?? tool.label;
      button.setAttribute('aria-pressed', String(markup?.activeToolId === tool.id));
    }
    status.textContent = reason ?? '';
  };

  const onToggle = () => {
    const visible = !preferences.snapshot().markupToolbarVisible;
    const activeToolId = activeMarkup()?.activeToolId;
    if (!visible && activeToolId && markupToolIds.has(activeToolId)) setActiveTool(null);
    preferences.update({ markupToolbarVisible: visible });
  };
  const onToolClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-markup-tool]',
    );
    const toolId = button?.dataset.markupTool;
    const markup = activeMarkup();
    if (!button || button.disabled || !toolId || !markup || markup.readOnlyReason !== null) return;
    setActiveTool(toolAfterChoosing(markup.activeToolId, toolId));
    render();
  };

  toggle.addEventListener('click', onToggle);
  group.addEventListener('click', onToolClick);
  const unobserve = preferences.observe(render);
  render();

  return {
    refresh: render,
    toggle: onToggle,
    destroy() {
      toggle.removeEventListener('click', onToggle);
      group.removeEventListener('click', onToolClick);
      unobserve();
      bar.replaceChildren();
    },
  };
}
