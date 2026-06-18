/**
 * Check whether a requested numeric value differs from the current value.
 * Used as a no-op guard to skip unnecessary re-renders when the value hasn't changed.
 */
export function hasValueChanged(current: number, requested: number): boolean {
  return current !== requested;
}
