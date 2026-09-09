import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';

declare global {
  interface Window {
    embedPdfSmoke?: {
      currentPage: number;
      initialZoom: number;
      linkLocation: number;
      linkPage: number;
      pageCount: number;
      pageAfterLinkClick: number;
      zoom: number;
    };
  }
}

function createRequiredFontPdf(): Uint8Array {
  const content = 'BT /F1 24 Tf 72 720 Td <4F60597D> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> /Annots [10 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [8 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 9 0 R >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
    '<< /Type /Annot /Subtype /Link /P 3 0 R /Rect [72 680 180 730] /Border [0 0 1] /A << /S /GoTo /D [4 0 R /XYZ 0 600 1] >> >>',
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
    const linkState: { position: { page: number; location: number } | null } = {
      position: null,
    };
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
        linkTargetRequested: async (target) => {
          linkState.position = target.readingPosition ?? null;
        },
      },
    });
    surface.rendering.setVisible(true);
    await surface.rendering.setZoomIntent({ kind: 'manual', scale: 1 });
    const initialZoom = surface.rendering.getState().zoom;
    let link: Element | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      link =
        document
          .querySelector('embedpdf-container')
          ?.shadowRoot?.querySelector(
            '[style*="cursor: pointer"]' +
              '[style*="pointer-events: auto"], ' +
              '[style*="cursor: pointer"]' +
              '[style*="pointer-events: visible"]',
          ) ?? null;
      if (link) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!link) throw new Error('EmbedPDF did not render the internal link annotation');
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
    for (let attempt = 0; attempt < 50 && linkState.position === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const linkPosition = linkState.position;
    if (linkPosition === null) throw new Error('EmbedPDF did not delegate the internal link');
    const pageAfterLinkClick = surface.rendering.getState().currentPage;
    await surface.rendering.goToPage(2);
    await surface.rendering.zoomIn();
    let state = surface.rendering.getState();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (state.currentPage === 2 && state.zoom > initialZoom) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
      state = surface.rendering.getState();
    }
    window.embedPdfSmoke = {
      currentPage: state.currentPage,
      initialZoom,
      linkLocation: linkPosition.location,
      linkPage: linkPosition.page,
      pageCount: state.totalPages,
      pageAfterLinkClick,
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
