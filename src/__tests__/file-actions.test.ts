// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentIntake, DocumentIntakeResult } from '../reader/document-intake';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../app/dialogs', () => ({ showToast: mocks.showToast }));

const result = (paths: readonly string[]): DocumentIntakeResult => ({
  outcomes: paths.map((filePath) => ({ status: 'opened', requestedPath: filePath, filePath })),
  opened: paths.length,
  activated: 0,
  failed: 0,
});

describe('Document picker adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(['/docs/report.pdf']);
  });

  it('passes the authorized picker selection to Document Intake', async () => {
    const intake = {
      open: vi.fn(async (paths: readonly string[]) => result(paths)),
    } as unknown as DocumentIntake;
    const { openPDFFile } = await import('../app/file-actions');

    await expect(openPDFFile(intake)).resolves.toBe(1);

    expect(mocks.invoke).toHaveBeenCalledWith('open_pdf_dialog');
    expect(intake.open).toHaveBeenCalledWith(['/docs/report.pdf'], { activate: true });
  });

  it('translates each typed intake failure without changing the result', async () => {
    const failedResult: DocumentIntakeResult = {
      outcomes: [
        { status: 'opened', requestedPath: '/docs/one.pdf', filePath: '/docs/one.pdf' },
        { status: 'failed', requestedPath: '/docs/bad.pdf', error: new Error('invalid PDF') },
      ],
      opened: 1,
      activated: 0,
      failed: 1,
    };
    const intake = {
      open: vi.fn(async () => failedResult),
    } as unknown as DocumentIntake;
    const { intakeFiles, reportDocumentIntakeOutcomes } = await import('../app/file-actions');
    const onError = vi.fn();

    const observed = await intakeFiles(['/docs/one.pdf', '/docs/bad.pdf'], { intake });
    reportDocumentIntakeOutcomes(observed, onError);

    expect(observed).toBe(failedResult);
    expect(onError).toHaveBeenCalledWith('Failed to open /docs/bad.pdf: invalid PDF');
  });
});
