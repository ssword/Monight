import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { browserPrintAdapter } from '../app/browser-print-adapter';
import type { PrintAdapter, PrintDocumentRequest } from '../reader/reader-actions';

interface PrintAdapterHarness {
  readonly adapter: PrintAdapter;
  readonly printCount: () => number;
}

const request: PrintDocumentRequest = {
  filePath: '/docs/report.pdf',
  title: 'report.pdf',
  bytes: new Uint8Array([1, 2, 3]),
};

function expectPrintAdapterContract(
  name: string,
  createHarness: (failure?: Error) => PrintAdapterHarness,
): void {
  describe(name, () => {
    it('completes after handing the current Document to the platform printer', async () => {
      const harness = createHarness();

      await harness.adapter.print(request);

      expect(harness.printCount()).toBe(1);
    });

    it('reports platform failures to the Reader Action caller', async () => {
      const failure = new Error('platform print failed');
      const harness = createHarness(failure);

      await expect(harness.adapter.print(request)).rejects.toBe(failure);
    });
  });
}

describe('Print adapter contract', () => {
  expectPrintAdapterContract('in-memory adapter', (failure) => {
    const printed: PrintDocumentRequest[] = [];
    return {
      adapter: {
        async print(nextRequest) {
          if (failure) throw failure;
          printed.push(nextRequest);
        },
      },
      printCount: () => printed.length,
    };
  });

  expectPrintAdapterContract('browser production adapter', (failure) => {
    const browser = new Window();
    let printCount = 0;
    const appendChild = browser.document.body.appendChild.bind(browser.document.body);
    vi.stubGlobal('document', browser.document);
    vi.stubGlobal('window', browser);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:print-contract');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    Object.defineProperty(browser, 'setTimeout', {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    Object.defineProperty(browser.document.body, 'appendChild', {
      configurable: true,
      value: (node: Parameters<typeof appendChild>[0]) => {
        const appended = appendChild(node);
        const iframe = node as unknown as HTMLIFrameElement;
        Object.defineProperty(iframe.contentWindow, 'print', {
          configurable: true,
          value: () => {
            if (failure) throw failure;
            printCount += 1;
          },
        });
        queueMicrotask(() => iframe.onload?.(new browser.Event('load') as never));
        return appended;
      },
    });
    return { adapter: browserPrintAdapter, printCount: () => printCount };
  });
});
