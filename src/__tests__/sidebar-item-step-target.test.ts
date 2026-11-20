import { describe, expect, it } from 'vitest';
import { type SidebarItem, stepTarget } from '../app/sidebar-item-stepping';

const item = (key: string, page: number): SidebarItem => ({ key, page, activate: () => {} });
const outline = [item('a', 3), item('b', 7)];
const keyOf = (target: SidebarItem | null) => target?.key ?? null;

describe('stepTarget with nothing selected', () => {
  it('steps to the nearest item in the requested direction', () => {
    expect(keyOf(stepTarget(outline, null, 4, 'previous'))).toBe('a');
    expect(keyOf(stepTarget(outline, null, 4, 'next'))).toBe('b');
  });

  it('goes to the neighbours of an item exactly on the current page', () => {
    const three = [item('a', 3), item('b', 4), item('c', 7)];
    expect(keyOf(stepTarget(three, null, 4, 'previous'))).toBe('a');
    expect(keyOf(stepTarget(three, null, 4, 'next'))).toBe('c');
  });

  it('has no target beyond the ends', () => {
    expect(stepTarget(outline, null, 1, 'previous')).toBeNull();
    expect(stepTarget(outline, null, 9, 'next')).toBeNull();
  });
});

describe('stepTarget with a selection', () => {
  it('steps from the selected item while it is on the current page', () => {
    expect(keyOf(stepTarget(outline, 'a', 3, 'next'))).toBe('b');
  });

  it('prefers the Reading Position over a stale selection on another page', () => {
    // Selected item a (page 3), but the reader has since moved to page 8.
    expect(keyOf(stepTarget(outline, 'a', 8, 'previous'))).toBe('b');
    expect(stepTarget(outline, 'a', 8, 'next')).toBeNull();
  });
});
