import { describe, expect, it, vi } from 'vitest';
import { createTauriPdfSource } from '../app/pdf-source';
import { createInMemoryPdfSource, type PdfSource } from '../reader/pdf-source';

async function expectPdfSourceContract(source: PdfSource): Promise<void> {
  await expect(source.describe('/alias/report.pdf')).resolves.toEqual({
    canonicalPath: '/docs/report.pdf',
    title: 'report.pdf',
  });
  await expect(source.read('/docs/report.pdf')).resolves.toEqual(new Uint8Array([1, 2, 3]));
}

describe('PDF source adapters', () => {
  it('covers the in-memory adapter contract at the Document Intake seam', async () => {
    const source = createInMemoryPdfSource([
      {
        requestedPaths: ['/alias/report.pdf', '/docs/report.pdf'],
        canonicalPath: '/docs/report.pdf',
        title: 'report.pdf',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);

    await expectPdfSourceContract(source);
  });

  it('covers the production metadata-then-binary transport contract', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'describe_pdf_file') {
        return { canonicalPath: '/docs/report.pdf', title: 'report.pdf' };
      }
      if (command === 'read_pdf_file') return new Uint8Array([1, 2, 3]).buffer;
      throw new Error(`Unexpected command: ${command}`);
    });
    const source = createTauriPdfSource(invoke);

    await expectPdfSourceContract(source);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'describe_pdf_file',
      'read_pdf_file',
    ]);
  });
});
