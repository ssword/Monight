// The toolbar's Highlight split button. Clicking it with text selected marks the
// selection at once; with nothing selected it toggles highlight mode, in which
// each text selection becomes a mark. The dropdown chooses the colour (a chrome
// preference) and, among the verified text-markup tools (markup-tools.ts), which
// mark the button makes. Unverified tools are absent, never disabled.

import { hydrateChromeIcons } from './chrome-icons';
import type { ChromePreferencesAuthority } from './chrome-preferences';
import type { ActiveMarkupState } from './document-workspace';
import {
  HIGHLIGHT_COLORS,
  type HighlightColorId,
  highlightStrokeColor,
  VERIFIED_MARKUP_TOOLS,
  type VerifiedMarkupTool,
  verifiedMarkupTools,
} from './markup-tools';

/** Annotation defaults the button applies to the marks it makes. */
export interface MarkupDefaults {
  readonly strokeColor: string;
}

export interface HighlightButtonElements {
  readonly button: HTMLButtonElement;
  readonly menuToggle: HTMLButtonElement;
  readonly menu: HTMLElement;
}

export interface HighlightButtonOptions {
  readonly elements: HighlightButtonElements;
  readonly preferences: ChromePreferencesAuthority;
  /** The verified tools; defaults to VERIFIED_MARKUP_TOOLS. */
  readonly tools?: readonly VerifiedMarkupTool[];
  readonly activeMarkup: () => ActiveMarkupState | null;
  /** Chooses a tool on the active Document (with its defaults), or null for text selection. */
  readonly setActiveTool: (toolId: string | null, defaults?: MarkupDefaults) => void;
  /** Marks the active Document's text selection; false when nothing is selected. */
  readonly markupSelection: (toolId: string, defaults: MarkupDefaults) => boolean;
}

export interface HighlightButton {
  /** Re-reads the active Document; call on Reading Session and rendering changes. */
  refresh(): void;
  destroy(): void;
}

export function createHighlightButton({
  elements: { button, menuToggle, menu },
  preferences,
  tools = VERIFIED_MARKUP_TOOLS,
  activeMarkup,
  setActiveTool,
  markupSelection,
}: HighlightButtonOptions): HighlightButton {
  const markupTools = verifiedMarkupTools('highlight-menu', tools);
  const markupToolIds = new Set(markupTools.map(({ id }) => id));
  let currentTool: VerifiedMarkupTool | undefined = markupTools[0];

  const menuItem = (label: string) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'toolbar-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.textContent = label;
    return item;
  };
  const colorItems = HIGHLIGHT_COLORS.map((color) => {
    const item = menuItem(color.label);
    item.dataset.highlightColor = color.id;
    const swatch = document.createElement('span');
    swatch.className = 'highlight-swatch';
    swatch.style.setProperty('--highlight-color', color.strokeColor);
    swatch.setAttribute('aria-hidden', 'true');
    item.prepend(swatch);
    return item;
  });
  const toolItems = markupTools.map((tool) => {
    const item = menuItem(tool.label);
    item.dataset.highlightTool = tool.id;
    return item;
  });
  const separator = document.createElement('div');
  separator.className = 'toolbar-menu-separator';
  separator.setAttribute('role', 'separator');
  menu.replaceChildren(...colorItems, separator, ...toolItems);
  menu.dataset.tauriDragRegion = 'false';
  menu.hidden = true;

  const icon = document.createElement('span');
  icon.className = 'toolbar-icon';
  button.replaceChildren(icon);
  menuToggle.setAttribute('aria-haspopup', 'menu');
  menuToggle.setAttribute('aria-controls', menu.id);

  const menuOpen = () => !menu.hidden;
  const setMenuOpen = (open: boolean) => {
    menu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
  };
  const defaults = (): MarkupDefaults => ({
    strokeColor: highlightStrokeColor(preferences.snapshot().highlightColor),
  });
  const editable = (markup: ActiveMarkupState | null): markup is ActiveMarkupState =>
    Boolean(markup && markup.readOnlyReason === null && currentTool);

  let renderedIcon = '';
  const render = () => {
    const markup = activeMarkup();
    const reason = markup?.readOnlyReason ?? null;
    const unavailable = !editable(markup);
    const label = currentTool?.label ?? 'Highlight';
    button.disabled = unavailable;
    menuToggle.disabled = unavailable;
    if (unavailable && menuOpen()) setMenuOpen(false);
    button.title = reason ?? label;
    menuToggle.title = reason ?? `${label} Colour`;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(markupToolIds.has(markup?.activeToolId ?? '')));
    const { highlightColor } = preferences.snapshot();
    button.style.setProperty('--highlight-color', highlightStrokeColor(highlightColor));
    for (const item of colorItems)
      item.setAttribute('aria-checked', String(item.dataset.highlightColor === highlightColor));
    for (const item of toolItems)
      item.setAttribute('aria-checked', String(item.dataset.highlightTool === currentTool?.id));
    const iconName = currentTool?.icon ?? 'highlighter';
    if (iconName !== renderedIcon) {
      renderedIcon = iconName;
      icon.dataset.icon = iconName;
      hydrateChromeIcons(button);
    }
  };

  const onButtonClick = () => {
    const markup = activeMarkup();
    if (!editable(markup) || !currentTool) return;
    if (markupToolIds.has(markup.activeToolId ?? '')) setActiveTool(null);
    else if (!markupSelection(currentTool.id, defaults()))
      setActiveTool(currentTool.id, defaults());
    render();
  };
  const onMenuToggle = () => {
    if (menuToggle.disabled) return;
    setMenuOpen(!menuOpen());
  };
  const onMenuClick = (event: MouseEvent) => {
    const item = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-highlight-color], [data-highlight-tool]',
    );
    if (!item) return;
    const color = item.dataset.highlightColor as HighlightColorId | undefined;
    if (color) preferences.update({ highlightColor: color });
    const tool = markupTools.find(({ id }) => id === item.dataset.highlightTool);
    if (tool) currentTool = tool;
    setMenuOpen(false);
    const markup = activeMarkup();
    if (editable(markup) && currentTool) {
      // In highlight mode the choice changes the mode's mark; otherwise it marks
      // any selection without entering the mode.
      if (markupToolIds.has(markup.activeToolId ?? '')) setActiveTool(currentTool.id, defaults());
      else markupSelection(currentTool.id, defaults());
    }
    render();
    button.focus();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!menuOpen()) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (menu.contains(target) || menuToggle.contains(target))) return;
    setMenuOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !menuOpen()) return;
    event.preventDefault();
    setMenuOpen(false);
    menuToggle.focus();
  };

  button.addEventListener('click', onButtonClick);
  menuToggle.addEventListener('click', onMenuToggle);
  menu.addEventListener('click', onMenuClick);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
  const unobserve = preferences.observe(render);
  render();

  return {
    refresh: render,
    destroy() {
      button.removeEventListener('click', onButtonClick);
      menuToggle.removeEventListener('click', onMenuToggle);
      menu.removeEventListener('click', onMenuClick);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      unobserve();
      menu.replaceChildren();
    },
  };
}
