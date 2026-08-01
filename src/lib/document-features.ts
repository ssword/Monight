export type ViewMode = 'single' | 'continuous' | 'spread';

export const VIEW_MODE_SEQUENCE: readonly ViewMode[] = ['single', 'continuous', 'spread'];

export function nextViewMode(mode: ViewMode): ViewMode {
  const currentIndex = VIEW_MODE_SEQUENCE.indexOf(mode);
  return VIEW_MODE_SEQUENCE[(currentIndex + 1) % VIEW_MODE_SEQUENCE.length];
}

export function viewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case 'single':
      return 'Single page';
    case 'continuous':
      return 'Continuous scroll';
    case 'spread':
      return 'Two-page spread';
  }
}

export function viewModeIcon(mode: ViewMode): string {
  switch (mode) {
    case 'single':
      return '⊟';
    case 'continuous':
      return '⊞';
    case 'spread':
      return '▥';
  }
}

export interface PdfSearchMatch {
  pageNumber: number;
  pageOccurrence: number;
  index: number;
  excerpt: string;
}

export function findPageTextMatches(
  pageText: string,
  query: string,
  pageNumber: number,
): PdfSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const haystack = pageText.toLocaleLowerCase();
  const matches: PdfSearchMatch[] = [];
  let fromIndex = 0;
  let pageOccurrence = 0;

  while (fromIndex <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) break;

    const excerptStart = Math.max(0, index - 35);
    const excerptEnd = Math.min(pageText.length, index + needle.length + 55);
    const prefix = excerptStart > 0 ? '…' : '';
    const suffix = excerptEnd < pageText.length ? '…' : '';

    matches.push({
      pageNumber,
      pageOccurrence,
      index,
      excerpt: `${prefix}${pageText.slice(excerptStart, excerptEnd).replace(/\s+/g, ' ').trim()}${suffix}`,
    });

    pageOccurrence += 1;
    fromIndex = index + Math.max(needle.length, 1);
  }

  return matches;
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number | null;
  url?: string;
  bold: boolean;
  italic: boolean;
  items: PdfOutlineItem[];
}

export type PdfAnnotationKind = 'highlight' | 'note';
export type PdfAnnotationColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface PdfAnnotationRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfAnnotation {
  id: string;
  kind: PdfAnnotationKind;
  pageNumber: number;
  rects: PdfAnnotationRect[];
  text: string;
  note: string;
  color: PdfAnnotationColor;
  createdAt: number;
  updatedAt: number;
}

export interface RecentFile {
  filePath: string;
  title: string;
  openedAt: number;
}

export function updateRecentFiles(
  recentFiles: readonly RecentFile[],
  opened: RecentFile,
  limit = 8,
): RecentFile[] {
  return [opened, ...recentFiles.filter((recent) => recent.filePath !== opened.filePath)].slice(
    0,
    Math.max(0, limit),
  );
}
