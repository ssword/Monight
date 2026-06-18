/**
 * Lazy loader for the PDF.js rendering engine.
 *
 * Defers the heavy pdfjs-dist import until the first document is opened,
 * allowing the app shell and splash screen to render faster.
 *
 * The import is cached so subsequent calls return the same module.
 */

type PdfJsLib = typeof import('pdfjs-dist');

let cachedEngine: Promise<PdfJsLib> | null = null;
let loaded = false;

/**
 * The actual import function. Separated so tests can verify caching
 * behavior without needing browser APIs that pdfjs-dist requires.
 */
function loadAndConfigure(): Promise<PdfJsLib> {
  return import('pdfjs-dist').then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    loaded = true;
    return pdfjsLib;
  });
}

/**
 * Returns the pdfjs-dist library module, loading it lazily on first call.
 *
 * On first invocation, performs a dynamic `import('pdfjs-dist')` and
 * configures the PDF.js worker. The result is cached — subsequent calls
 * return the same promise without re-importing.
 */
export function getPdfEngine(): Promise<PdfJsLib> {
  if (cachedEngine) {
    return cachedEngine;
  }

  cachedEngine = loadAndConfigure();
  return cachedEngine;
}

/**
 * Returns true if the PDF engine has been fully loaded and configured.
 */
export function isPdfEngineLoaded(): boolean {
  return loaded;
}

/**
 * Reset the cached engine state. For testing only.
 */
export function _resetForTesting(): void {
  cachedEngine = null;
  loaded = false;
}
