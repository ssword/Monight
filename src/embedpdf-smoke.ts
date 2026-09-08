import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';

declare global {
  interface Window {
    embedPdfSmoke?: {
      currentPage: number;
      pageCount: number;
      zoom: number;
    };
  }
}

function createRequiredFontPdf(): Uint8Array {
  const content = 'BT /F1 24 Tf 72 720 Td <4F60597D> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ];
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n';
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function run(): Promise<void> {
  try {
    const factory = createEmbedPdfDocumentSurfaceFactory();
    const surface = await factory({
      filePath: '/fixtures/required-font.pdf',
      title: 'required-font.pdf',
      bytes: createRequiredFontPdf(),
      callbacks: {
        readingPositionObserved: () => undefined,
        readingPositionSettled: () => undefined,
        stateChanged: () => undefined,
        pageNavigationRequested: async () => undefined,
        zoomIntentRequested: async () => undefined,
      },
    });
    surface.rendering.setVisible(true);
    await surface.rendering.goToPage(1);
    await surface.rendering.zoomIn();
    const state = surface.rendering.getState();
    window.embedPdfSmoke = {
      currentPage: state.currentPage,
      pageCount: state.totalPages,
      zoom: state.zoom,
    };
    document.body.dataset.status = 'ready';
  } catch (error) {
    document.body.dataset.status = 'failed';
    document.body.dataset.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

void run();
