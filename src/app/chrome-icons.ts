// Reader chrome icons come from one bundled, open-licensed outline set
// (Lucide, ISC). Icons are compiled into the app bundle, never fetched.
import {
  ChevronDown,
  createElement,
  FileText,
  FolderOpen,
  Highlighter,
  type IconNode,
  Moon,
  Palette,
  PanelLeft,
  PenLine,
  Presentation,
  Printer,
  Scan,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from 'lucide';

const CHROME_ICONS: Readonly<Record<string, IconNode>> = {
  'chevron-down': ChevronDown,
  'file-text': FileText,
  'folder-open': FolderOpen,
  highlighter: Highlighter,
  markup: PenLine,
  moon: Moon,
  palette: Palette,
  presentation: Presentation,
  printer: Printer,
  sidebar: PanelLeft,
  'sticky-note': StickyNote,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  'zoom-to-fit': Scan,
};

/** Fills every `[data-icon]` slot under root with its bundled outline icon. */
export function hydrateChromeIcons(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = slot.dataset.icon ?? '';
    const icon = CHROME_ICONS[name];
    if (!icon) throw new Error(`Unknown chrome icon: ${name}`);
    const svg = createElement(icon, {
      width: '18',
      height: '18',
      'stroke-width': '1.75',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    slot.replaceChildren(svg);
  }
}
