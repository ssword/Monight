import type { PrintAdapter } from '../reader/reader-actions';

export const browserPrintAdapter: PrintAdapter = {
  print({ bytes }) {
    return new Promise<void>((resolve, reject) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.inset = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.visibility = 'hidden';
      iframe.src = blobUrl;

      const cleanup = () => {
        iframe.remove();
        URL.revokeObjectURL(blobUrl);
      };

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          window.setTimeout(cleanup, 1_000);
          resolve();
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      iframe.onerror = () => {
        cleanup();
        reject(new Error('Failed to load PDF for printing'));
      };

      document.body.appendChild(iframe);
    });
  },
};
