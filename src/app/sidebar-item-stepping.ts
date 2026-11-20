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

/** The item a step reaches, from the selected item or else from the Reading Position. */
export function stepTarget(
  items: readonly SidebarItem[],
  selectedKey: string | null,
  currentPage: number,
  direction: StepDirection,
): SidebarItem | null {
  const forward = direction === 'next';
  const selected = selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  // A stale selection (the reader has since moved to another page) yields to the
  // Reading Position: the selection is the start only while it is on the current page.
  if (selected >= 0 && items[selected]?.page === currentPage) {
    return items[forward ? selected + 1 : selected - 1] ?? null;
  }
  // An item exactly on the current page: step to the neighbours of that item.
  const onPage = items.flatMap((item, index) => (item.page === currentPage ? [index] : []));
  if (onPage.length > 0) {
    // With several items on the page the first is the start, so Next walks through the rest.
    const edge = onPage[0]!;
    return items[forward ? edge + 1 : edge - 1] ?? null;
  }
  // Otherwise the nearest item in the requested direction.
  let best: SidebarItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = forward ? item.page - currentPage : currentPage - item.page;
    // Later items win ties when stepping back, earlier ones when stepping forward.
    if (distance > 0 && (distance < bestDistance || (!forward && distance === bestDistance))) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
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
