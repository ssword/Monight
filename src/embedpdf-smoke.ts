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

async function run(): Promise<void> {
  try {
    const linkState: { position: { page: number; location: number } | null } = {
      position: null,
    };
    const fixtureResponse = await fetch('/src-tauri/tests/fixtures/tester-kit/fallback-font.pdf');
    if (!fixtureResponse.ok) throw new Error('Could not load the fallback-font Document fixture');
    const factory = createEmbedPdfDocumentSurfaceFactory();
    const surface = await factory({
      filePath: '/fixtures/required-font.pdf',
      title: 'required-font.pdf',
      bytes: new Uint8Array(await fixtureResponse.arrayBuffer()),
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
    const host = document.getElementById('surface-host');
    if (!host) throw new Error('Missing hidden surface host');
    host.style.visibility = 'visible';
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
