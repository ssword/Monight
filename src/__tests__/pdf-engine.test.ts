import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock pdfjs-dist so the dynamic import() resolves in Node
// without needing browser APIs like DOMMatrix
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '0.0.0-test',
}));

import { _resetForTesting, getPdfEngine, isPdfEngineLoaded } from '../lib/pdf-engine';

describe('getPdfEngine', () => {
  afterEach(() => {
    _resetForTesting();
  });

  it('returns a module with getDocument function', async () => {
    const engine = await getPdfEngine();

    expect(engine).toBeDefined();
    expect(typeof engine.getDocument).toBe('function');
  });

  it('returns the same promise on subsequent calls (cached)', () => {
    const promise1 = getPdfEngine();
    const promise2 = getPdfEngine();

    expect(promise1).toBe(promise2);
  });

  it('returns the same module instance on subsequent awaits', async () => {
    const engine1 = await getPdfEngine();
    const engine2 = await getPdfEngine();

    expect(engine1).toBe(engine2);
  });
});

describe('isPdfEngineLoaded', () => {
  afterEach(() => {
    _resetForTesting();
  });

  it('returns false before engine is loaded', () => {
    expect(isPdfEngineLoaded()).toBe(false);
  });

  it('returns true after engine has loaded', async () => {
    await getPdfEngine();

    expect(isPdfEngineLoaded()).toBe(true);
  });

  it('returns false after reset', async () => {
    await getPdfEngine();
    _resetForTesting();

    expect(isPdfEngineLoaded()).toBe(false);
  });
});

describe('worker configuration', () => {
  afterEach(() => {
    _resetForTesting();
  });

  it('sets GlobalWorkerOptions.workerSrc after loading', async () => {
    const engine = await getPdfEngine();

    // The worker source should be set to a non-empty string
    expect(engine.GlobalWorkerOptions.workerSrc).toBeTruthy();
    expect(typeof engine.GlobalWorkerOptions.workerSrc).toBe('string');
  });
});
