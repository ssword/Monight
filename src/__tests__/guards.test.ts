import { describe, expect, it } from 'vitest';
import { hasValueChanged } from '../lib/guards';

describe('hasValueChanged', () => {
  it('returns false when requested value equals current value', () => {
    expect(hasValueChanged(1.5, 1.5)).toBe(false);
    expect(hasValueChanged(0, 0)).toBe(false);
    expect(hasValueChanged(5.0, 5.0)).toBe(false);
  });

  it('returns true when values differ', () => {
    expect(hasValueChanged(1.0, 1.5)).toBe(true);
    expect(hasValueChanged(2.0, 1.75)).toBe(true);
    expect(hasValueChanged(0, 1)).toBe(true);
  });
});
