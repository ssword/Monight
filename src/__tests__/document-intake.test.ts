import { describe, expect, it, vi } from 'vitest';
import { createDocumentIntake } from '../reader/document-intake';

describe('Document Intake', () => {
  it('activates an existing canonical Document without rereading bytes', async () => {
    const source = {
      describe: vi.fn(async () => ({ canonicalPath: '/docs/report.pdf', title: 'report.pdf' })),
      read: vi.fn(async () => new Uint8Array([1, 2, 3])),
    };
    const runtime = {
      isOpen: vi.fn(() => true),
      activate: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
    };
    const intake = createDocumentIntake({ source, runtime });

    const result = await intake.open(['/alias/report.pdf'], { page: 8 });

    expect(result.outcomes).toEqual([
      { status: 'activated', requestedPath: '/alias/report.pdf', filePath: '/docs/report.pdf' },
    ]);
    expect(source.read).not.toHaveBeenCalled();
    expect(runtime.open).not.toHaveBeenCalled();
    expect(runtime.activate).toHaveBeenCalledWith('/docs/report.pdf');
    expect(runtime.goToPage).toHaveBeenCalledWith('/docs/report.pdf', 8);
  });

  it('reports independent outcomes for every requested path', async () => {
    const source = {
      describe: vi.fn(async (path: string) => {
        if (path.includes('bad')) throw new Error('invalid PDF');
        return { canonicalPath: path, title: path.split('/').pop() ?? path };
      }),
      read: vi.fn(async () => new Uint8Array([1, 2, 3])),
    };
    const runtime = {
      isOpen: vi.fn(() => false),
      activate: vi.fn(),
      open: vi.fn(async () => undefined),
      goToPage: vi.fn(),
    };
    const intake = createDocumentIntake({ source, runtime });

    const result = await intake.open(['/docs/one.pdf', '/docs/bad.pdf', '/docs/two.pdf']);

    expect(result.outcomes.map(({ status }) => status)).toEqual(['opened', 'failed', 'opened']);
    expect(runtime.open).toHaveBeenCalledTimes(2);
  });

  it('does not transfer the first explicit page when the first Document fails', async () => {
    const source = {
      describe: vi.fn(async (path: string) => {
        if (path.endsWith('first.pdf')) throw new Error('missing');
        return { canonicalPath: path, title: 'second.pdf' };
      }),
      read: vi.fn(async () => new Uint8Array([1])),
    };
    const runtime = {
      isOpen: vi.fn(() => false),
      activate: vi.fn(),
      open: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
    };
    const intake = createDocumentIntake({ source, runtime });

    await intake.open(['/docs/first.pdf', '/docs/second.pdf'], { page: 12 });

    expect(runtime.goToPage).not.toHaveBeenCalled();
  });

  it('notifies observers only after a new Document is fully open', async () => {
    const events: string[] = [];
    const intake = createDocumentIntake({
      source: {
        describe: async () => {
          events.push('describe');
          return { canonicalPath: '/docs/report.pdf', title: 'report.pdf' };
        },
        read: async () => {
          events.push('read');
          return new Uint8Array([1]);
        },
      },
      runtime: {
        isOpen: () => false,
        activate: vi.fn(),
        open: async () => {
          events.push('open');
        },
        goToPage: vi.fn(),
      },
      onSucceeded: () => {
        events.push('observe');
        throw new Error('history unavailable');
      },
      onObserverError: () => events.push('observer-error'),
    });

    const result = await intake.open(['/docs/report.pdf']);

    expect(result.outcomes[0].status).toBe('opened');
    expect(events).toEqual(['describe', 'read', 'open', 'observe', 'observer-error']);
  });

  it('reports foreground readiness before remaining intake completes', async () => {
    let releaseSecond: (() => void) | undefined;
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({ canonicalPath: path, title: path }),
        read: async (path) => {
          if (path.endsWith('second.pdf')) {
            await new Promise<void>((resolve) => {
              releaseSecond = resolve;
            });
          }
          return new Uint8Array([1]);
        },
      },
      runtime: {
        isOpen: () => false,
        activate: vi.fn(),
        open: vi.fn(async () => undefined),
        goToPage: vi.fn(),
      },
    });

    const operation = intake.begin(['/docs/first.pdf', '/docs/second.pdf']);

    await expect(operation.foreground).resolves.toMatchObject({
      status: 'opened',
      filePath: '/docs/first.pdf',
    });
    await vi.waitFor(() => expect(releaseSecond).toBeTypeOf('function'));
    releaseSecond?.();
    await expect(operation.completion).resolves.toMatchObject({ opened: 2, failed: 0 });
  });
});
