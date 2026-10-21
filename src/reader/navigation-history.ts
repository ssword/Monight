// Navigation History: per-Document jumps made during this app run, retraced by
// Back and Forward. It lives only in memory; it is never part of the Reading
// Session and is discarded when its Document closes.

import type { RestorableReadingPosition } from './reader-actions';

export type NavigationDirection = 'back' | 'forward';

interface DocumentHistory {
  back: RestorableReadingPosition[];
  forward: RestorableReadingPosition[];
}

export interface NavigationHistories {
  canGo(filePath: string, direction: NavigationDirection): boolean;
  /** Where Back or Forward would go, without moving. */
  target(filePath: string, direction: NavigationDirection): RestorableReadingPosition | null;
  /** A new jump away from `from`; it discards the forward entries. */
  record(filePath: string, from: RestorableReadingPosition): void;
  /**
   * Back or Forward has moved away from `from` to its target. With no known
   * `from`, the target is still consumed so repeated steps never loop.
   */
  stepped(
    filePath: string,
    direction: NavigationDirection,
    from: RestorableReadingPosition | null,
  ): void;
  discard(filePath: string): void;
  /** The Document is now known by another path (Save As, path canonicalization). */
  rename(fromPath: string, toPath: string): void;
}

export function createNavigationHistories(): NavigationHistories {
  const histories = new Map<string, DocumentHistory>();
  const historyFor = (filePath: string): DocumentHistory => {
    let history = histories.get(filePath);
    if (!history) {
      history = { back: [], forward: [] };
      histories.set(filePath, history);
    }
    return history;
  };
  const opposite = (direction: NavigationDirection): NavigationDirection =>
    direction === 'back' ? 'forward' : 'back';

  return {
    canGo: (filePath, direction) => (histories.get(filePath)?.[direction].length ?? 0) > 0,
    target: (filePath, direction) => {
      const entries = histories.get(filePath)?.[direction] ?? [];
      return entries[entries.length - 1] ?? null;
    },
    record(filePath, from) {
      const history = historyFor(filePath);
      history.back.push(from);
      history.forward = [];
    },
    stepped(filePath, direction, from) {
      const history = historyFor(filePath);
      history[direction].pop();
      if (from) history[opposite(direction)].push(from);
    },
    discard(filePath) {
      histories.delete(filePath);
    },
    rename(fromPath, toPath) {
      if (fromPath === toPath) return;
      const history = histories.get(fromPath);
      histories.delete(fromPath);
      // A Document already known by `toPath` keeps its own history.
      if (history && !histories.has(toPath)) histories.set(toPath, history);
    },
  };
}
