// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../app/dialogs', () => ({ showToast: mocks.showToast }));

describe('Document picker intake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case 'open_pdf_dialog':
          return ['/docs/report.pdf'];
        case 'describe_pdf_file':
          return { canonicalPath: '/docs/report.pdf', title: 'report.pdf' };
        case 'read_pdf_file':
          return new ArrayBuffer(4);
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  it('uses the authorizing Rust picker before validating and reading its selection', async () => {
    const tabManager = {
      getTabs: vi.fn(() => []),
      createTab: vi.fn(async () => undefined),
    };
    const { openPDFFile } = await import('../app/file-actions');

    const opened = await openPDFFile(tabManager as never);

    expect(opened).toBe(1);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'open_pdf_dialog',
      'describe_pdf_file',
      'read_pdf_file',
    ]);
  });

  it('keeps the production byte contract stable through the file-dialog intake seam', async () => {
    let responseBuffer: ArrayBuffer | undefined;
    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case 'open_pdf_dialog':
          return ['/docs/report.pdf'];
        case 'describe_pdf_file':
          return { canonicalPath: '/docs/report.pdf', title: 'report.pdf' };
        case 'read_pdf_file':
          responseBuffer = new Uint8Array([1, 2, 3]).buffer;
          return responseBuffer;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
    const tabManager = {
      getTabs: vi.fn(() => []),
      createTab: vi.fn(async (_filePath: string, _title: string, bytes: Uint8Array) => {
        expect(responseBuffer).toBeDefined();
        new Uint8Array(responseBuffer as ArrayBuffer)[0] = 9;
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
      }),
    };
    const { openPDFFile } = await import('../app/file-actions');

    await expect(openPDFFile(tabManager as never)).resolves.toBe(1);
  });

  it('routes an explicit page for an existing Document through its semantic runtime request', async () => {
    const tabManager = {
      getTabs: vi.fn(() => [{ id: 'report', filePath: '/docs/report.pdf' }]),
      createTab: vi.fn(async () => undefined),
      reactivateOpenDocument: vi.fn(async () => undefined),
      requestDocumentPage: vi.fn(async () => undefined),
    };
    const { openFiles } = await import('../app/file-actions');

    const opened = await openFiles(['/alias/report.pdf'], {
      tabManager: tabManager as never,
      page: 7,
    });

    expect(opened).toBe(0);
    expect(tabManager.reactivateOpenDocument).toHaveBeenCalledWith('report');
    expect(tabManager.requestDocumentPage).toHaveBeenCalledWith('/docs/report.pdf', 7);
    expect(mocks.invoke).not.toHaveBeenCalledWith('read_pdf_file', expect.anything());
  });

  it('keeps file-dialog paths independent and reports a failed sibling', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'open_pdf_dialog') {
        return ['/docs/one.pdf', '/docs/bad.pdf', '/docs/two.pdf'];
      }
      if (command === 'describe_pdf_file') {
        if (args?.path === '/docs/bad.pdf') throw new Error('invalid PDF');
        return {
          canonicalPath: args?.path,
          title: args?.path?.split('/').pop(),
        };
      }
      if (command === 'read_pdf_file') return new ArrayBuffer(4);
      throw new Error(`Unexpected command: ${command}`);
    });
    const tabManager = {
      getTabs: vi.fn(() => []),
      createTab: vi.fn(async () => undefined),
      requestDocumentPage: vi.fn(async () => undefined),
    };
    const { openPDFFile } = await import('../app/file-actions');

    const opened = await openPDFFile(tabManager as never);

    expect(opened).toBe(2);
    expect(tabManager.createTab).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Failed to open /docs/bad.pdf: invalid PDF',
      'error',
    );
  });

  it('translates every typed failure without rolling back successful siblings', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'describe_pdf_file') {
        if (args?.path?.includes('bad')) throw new Error(`invalid ${args.path}`);
        return { canonicalPath: args?.path, title: args?.path?.split('/').pop() };
      }
      if (command === 'read_pdf_file') return new ArrayBuffer(4);
      throw new Error(`Unexpected command: ${command}`);
    });
    const tabManager = {
      getTabs: vi.fn(() => []),
      createTab: vi.fn(async () => undefined),
    };
    const onError = vi.fn();
    const { intakeFiles, reportDocumentIntakeOutcomes } = await import('../app/file-actions');

    const result = await intakeFiles(
      ['/docs/one.pdf', '/docs/bad-one.pdf', '/docs/two.pdf', '/docs/bad-two.pdf'],
      { tabManager: tabManager as never },
    );
    reportDocumentIntakeOutcomes(result, onError);

    expect(result.outcomes.map(({ status }) => status)).toEqual([
      'opened',
      'failed',
      'opened',
      'failed',
    ]);
    expect(tabManager.createTab).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map(([message]) => message)).toEqual([
      'Failed to open /docs/bad-one.pdf: invalid /docs/bad-one.pdf',
      'Failed to open /docs/bad-two.pdf: invalid /docs/bad-two.pdf',
    ]);
  });

  it('shares canonical Document preparation across overlapping open requests', async () => {
    const releaseCreates: Array<() => void> = [];
    const tabs: Array<{ id: string; filePath: string }> = [];
    const tabManager = {
      getTabs: vi.fn(() => tabs),
      createTab: vi.fn(async (filePath: string) => {
        await new Promise<void>((resolve) => {
          releaseCreates.push(resolve);
        });
        tabs.push({ id: 'report', filePath });
      }),
      reactivateOpenDocument: vi.fn(async () => undefined),
      requestDocumentPage: vi.fn(async () => undefined),
    };
    const { openFiles } = await import('../app/file-actions');

    const first = openFiles(['/alias/report.pdf'], { tabManager: tabManager as never });
    await vi.waitFor(() => expect(releaseCreates).toHaveLength(1));
    const second = openFiles(['/other-alias/report.pdf'], { tabManager: tabManager as never });
    await vi.waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(([command]) => command === 'describe_pdf_file'),
      ).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const preparationCount = releaseCreates.length;
    for (const release of releaseCreates) release();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(0);
    expect(preparationCount).toBe(1);
    expect(tabManager.createTab).toHaveBeenCalledOnce();
    expect(tabManager.reactivateOpenDocument).toHaveBeenCalledWith('report');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'read_pdf_file')).toHaveLength(
      1,
    );
  });
});
