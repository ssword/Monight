// The single list of annotation tools that have passed ADR 0002's round-trip
// verification with Preview and Acrobat (ADR 0003). It drives the EmbedPDF
// tool configuration, the markup toolbar, the Highlight dropdown and
// Tools ▸ Annotate. Unverified tools are absent everywhere, never disabled.
//
// Adding a verified tool: append an entry below (with its verification
// record). No other change is needed for it to appear in its control.

/** Where a verified tool is offered in the reader chrome. */
export type MarkupToolControl =
  /** A button on the markup toolbar beneath the toolbar. */
  | 'markup-toolbar'
  /** A text-markup entry in the toolbar's Highlight split button dropdown. */
  | 'highlight-menu';

export interface VerifiedMarkupTool {
  /** EmbedPDF annotation tool id. */
  readonly id: string;
  /** Reader-facing name, used by buttons and menu items. */
  readonly label: string;
  /** Bundled chrome icon name (see chrome-icons.ts). */
  readonly icon: string;
  readonly control: MarkupToolControl;
  /** Interoperability records (Preview and Acrobat) that admitted the tool. */
  readonly verification: readonly string[];
}

export const VERIFIED_MARKUP_TOOLS: readonly VerifiedMarkupTool[] = Object.freeze([
  {
    id: 'highlight',
    label: 'Highlight',
    icon: 'highlighter',
    control: 'highlight-menu',
    verification: [
      'docs/issue-75-preview-verification.md',
      'docs/issue-80-acrobat-verification.md',
    ],
  },
  {
    id: 'textComment',
    label: 'Text Note',
    icon: 'sticky-note',
    control: 'markup-toolbar',
    verification: [
      'docs/issue-94-preview-text-annotations.md',
      'docs/issue-80-acrobat-verification.md',
    ],
  },
]);

/** Verified tools, optionally only those offered by one control, in list order. */
export function verifiedMarkupTools(
  control?: MarkupToolControl,
  tools: readonly VerifiedMarkupTool[] = VERIFIED_MARKUP_TOOLS,
): readonly VerifiedMarkupTool[] {
  return control ? tools.filter((tool) => tool.control === control) : tools;
}

/**
 * Page Rotation controls stay hidden until rotated pages, including their
 * existing Annotations, pass round-trip verification (ADR 0003).
 */
export const PAGE_ROTATION_VERIFIED = false;

/**
 * The tool a reader's choice leaves active: choosing the active tool again
 * returns to text selection (null). Shared by every control offering tools.
 */
export function toolAfterChoosing(activeToolId: string | null, toolId: string): string | null {
  return activeToolId === toolId ? null : toolId;
}

/** Colours offered by the Highlight split button, in menu order. */
export const HIGHLIGHT_COLORS = Object.freeze([
  // EmbedPDF's own highlight colour, the one ADR 0002's verification used.
  { id: 'yellow', label: 'Yellow', strokeColor: '#FFCD45' },
  { id: 'green', label: 'Green', strokeColor: '#7ED957' },
  { id: 'blue', label: 'Blue', strokeColor: '#6CB4F5' },
  { id: 'pink', label: 'Pink', strokeColor: '#FF7EB6' },
  { id: 'purple', label: 'Purple', strokeColor: '#B78CF2' },
] as const);

export type HighlightColorId = (typeof HIGHLIGHT_COLORS)[number]['id'];

/** The annotation stroke colour for a highlight colour. */
export function highlightStrokeColor(id: HighlightColorId): string {
  return (HIGHLIGHT_COLORS.find((color) => color.id === id) ?? HIGHLIGHT_COLORS[0]).strokeColor;
}
