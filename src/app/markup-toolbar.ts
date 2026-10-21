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
  /** Chooses a markup-toolbar tool as its button does. */
  chooseTool(toolId: string): void;
  destroy(): void;
}

export interface MarkupEscapeOptions {
  readonly activeMarkup: () => ActiveMarkupState | null;
  readonly setActiveTool: (toolId: string | null) => void;
  /** Presentation mode claims Esc to exit before anything else. */
  readonly presentationActive: () => boolean;
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Esc returns from any markup tool (highlight mode, the Text note tool) to text
 * selection. It yields to whatever owns Esc first: presentation mode, a focused
 * field such as Search, and an open menu or popover. Returns the unbinder.
 */
export function leaveMarkupToolOnEscape({
  activeMarkup,
  setActiveTool,
  presentationActive,
}: MarkupEscapeOptions): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || presentationActive()) return;
    if (isEditableTarget(event.target)) return;
    // Capture phase: an open popup has not closed yet and keeps this Esc.
    if (document.querySelector('[aria-expanded="true"]')) return;
    if (!activeMarkup()?.activeToolId) return;
    event.preventDefault();
    setActiveTool(null);
  };
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
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
  /** A tool button's choice; choosing the active tool returns to text selection. */
  const chooseTool = (toolId: string) => {
    const markup = activeMarkup();
    if (!markupToolIds.has(toolId) || !markup || markup.readOnlyReason !== null) return;
    setActiveTool(toolAfterChoosing(markup.activeToolId, toolId));
    render();
  };
  const onToolClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-markup-tool]',
    );
    const toolId = button?.dataset.markupTool;
    if (!button || button.disabled || !toolId) return;
    chooseTool(toolId);
  };

  toggle.addEventListener('click', onToggle);
  group.addEventListener('click', onToolClick);
  const unobserve = preferences.observe(render);
  render();

  return {
    refresh: render,
    toggle: onToggle,
    chooseTool,
    destroy() {
      toggle.removeEventListener('click', onToggle);
      group.removeEventListener('click', onToolClick);
      unobserve();
      bar.replaceChildren();
    },
  };
}
