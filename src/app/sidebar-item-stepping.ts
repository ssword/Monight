// Go ▸ Previous Item / Next Item: each sidebar mode lists its own ordered items
// (pages, outline entries, Annotations, Bookmarks) and this picks the one
// a step reaches. Stepping starts from the selected item, or from the item
// nearest the Reading Position when nothing is selected.

/** One steppable entry of a sidebar mode, in the mode's own order. */
export interface SidebarItem {
  /** Identifies the item within its mode's current list. */
  readonly key: string;
  /** The page the item belongs to, used to find the item nearest the Reading Position. */
  readonly page: number;
  /** Selects the item and goes to it the way a click does (recording Navigation History). */
  activate(): void | Promise<void>;
}

export type StepDirection = 'previous' | 'next';

export interface ItemStepping {
  readonly previous: boolean;
  readonly next: boolean;
}

export const NO_ITEM_STEPPING: ItemStepping = Object.freeze({ previous: false, next: false });

/** The item a step from the selected item (or the one nearest `currentPage`) reaches. */
export function stepTarget(
  items: readonly SidebarItem[],
  selectedKey: string | null,
  currentPage: number,
  direction: StepDirection,
): SidebarItem | null {
  if (items.length === 0) return null;
  let from = selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  if (from < 0) {
    // Earlier items win ties, so the start is the first item at the nearest page.
    let nearest = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
      const distance = Math.abs(item.page - currentPage);
      if (distance < nearest) {
        nearest = distance;
        from = index;
      }
    });
  }
  return items[direction === 'next' ? from + 1 : from - 1] ?? null;
}

export function itemStepping(
  items: readonly SidebarItem[],
  selectedKey: string | null,
  currentPage: number,
): ItemStepping {
  return {
    previous: stepTarget(items, selectedKey, currentPage, 'previous') !== null,
    next: stepTarget(items, selectedKey, currentPage, 'next') !== null,
  };
}
