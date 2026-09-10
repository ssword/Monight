import { describe, expect, it, vi } from 'vitest';
import {
  createDevelopmentDocumentSurfaceProvider,
  resolveDocumentSurfaceKind,
} from '../app/document-surface-gate';
import type { DocumentSurface } from '../app/document-workspace';
import { normalizeAnnotationDisplayName } from '../reader/native-pdf-editing';

describe('Document surface development gate', () => {
  it('keeps the existing reader as the default', () => {
    expect(resolveDocumentSurfaceKind(undefined)).toBe('pdfjs');
    expect(resolveDocumentSurfaceKind('anything-else')).toBe('pdfjs');
    expect(createDevelopmentDocumentSurfaceProvider(undefined)).toBeUndefined();
  });

  it('loads EmbedPDF only when the explicit development gate selects it', async () => {
    const surface = { rendering: {}, runtime: {} } as DocumentSurface;
    const factory = vi.fn(async () => surface);
    const createEmbedPdfDocumentSurfaceFactory = vi.fn(() => factory);
    const loadEmbedPdf = vi.fn(async () => ({
      createEmbedPdfDocumentSurfaceFactory,
    }));
    const provider = createDevelopmentDocumentSurfaceProvider('embedpdf', loadEmbedPdf);

    expect(resolveDocumentSurfaceKind('embedpdf')).toBe('embedpdf');
    expect(provider).toBeDefined();
    expect(loadEmbedPdf).not.toHaveBeenCalled();

    const requestPassword = vi.fn();
    const getAnnotationDisplayName = vi.fn(() => normalizeAnnotationDisplayName('Ada Lovelace'));
    const selectedFactory = provider?.({ requestPassword, getAnnotationDisplayName });
    expect(loadEmbedPdf).not.toHaveBeenCalled();
    await selectedFactory?.({} as never);

    expect(loadEmbedPdf).toHaveBeenCalledOnce();
    expect(createEmbedPdfDocumentSurfaceFactory).toHaveBeenCalledWith({
      requestPassword,
      getAnnotationDisplayName,
    });
    expect(factory).toHaveBeenCalledOnce();
  });
});
