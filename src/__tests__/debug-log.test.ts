import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugLog } from '../lib/debug-log';

describe('debugLog', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is silent when the dev-build flag is disabled', () => {
    vi.stubEnv('DEV', false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    debugLog('rendered page', 2);

    expect(log).not.toHaveBeenCalled();
  });

  it('logs diagnostics when the dev-build flag is enabled', () => {
    vi.stubEnv('DEV', true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    debugLog('rendered page', 2);

    expect(log).toHaveBeenCalledWith('rendered page', 2);
  });
});
