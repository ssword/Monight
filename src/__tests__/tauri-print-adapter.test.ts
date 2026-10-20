import { describe, expect, it, vi } from 'vitest';
import { createTauriPrintAdapter } from '../app/tauri-print-adapter';

const request = {
  filePath: '/docs/source.pdf',
  title: 'source.pdf',
  bytes: new Uint8Array([37, 80, 68, 70]),
};

describe('desktop PDF printing', () => {
  it('hands current bytes to native macOS printing without reopening the source path', async () => {
    const invokeCommand = vi.fn(async () => undefined);
    const fallback = { print: vi.fn(async () => undefined) };
    await createTauriPrintAdapter({ nativeMacOS: () => true, invokeCommand, fallback }).print(
      request,
    );
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith('print_pdf', {
      title: request.title,
      bytes: Array.from(request.bytes),
    });
    expect(fallback.print).not.toHaveBeenCalled();
    expect(request.bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('propagates native failure without attempting a second print', async () => {
    const error = new Error('native PDF could not be opened');
    const fallback = { print: vi.fn(async () => undefined) };
    const adapter = createTauriPrintAdapter({
      nativeMacOS: () => true,
      invokeCommand: vi.fn(async () => {
        throw error;
      }),
      fallback,
    });
    await expect(adapter.print(request)).rejects.toBe(error);
    expect(fallback.print).not.toHaveBeenCalled();
  });

  it('retains browser printing on other platforms', async () => {
    const invokeCommand = vi.fn(async () => undefined);
    const fallback = { print: vi.fn(async () => undefined) };
    await createTauriPrintAdapter({ nativeMacOS: () => false, invokeCommand, fallback }).print(
      request,
    );
    expect(fallback.print).toHaveBeenCalledExactlyOnceWith(request);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
