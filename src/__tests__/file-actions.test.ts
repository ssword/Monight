import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

describe('Document picker intake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case 'open_pdf_dialog':
          return ['/docs/report.pdf'];
        case 'validate_open_path':
          return '/docs/report.pdf';
        case 'read_pdf_file':
          return new ArrayBuffer(4);
        case 'get_file_name':
          return 'report.pdf';
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
      'validate_open_path',
      'get_file_name',
      'read_pdf_file',
    ]);
  });
});
