import type { PdfPasswordRequester } from '../reader/document-content';
import type { AnnotationDisplayName } from '../reader/native-pdf-editing';
import type { DocumentSurfaceFactory } from './document-workspace';

export type DocumentSurfaceKind = 'pdfjs' | 'embedpdf';

interface EmbedPdfSurfaceModule {
  createEmbedPdfDocumentSurfaceFactory(options: {
    requestPassword?: PdfPasswordRequester;
    assessEditing?: (bytes: Uint8Array) => Promise<string | null>;
    getAnnotationDisplayName?: () => AnnotationDisplayName;
  }): DocumentSurfaceFactory;
}

type LoadEmbedPdfSurface = () => Promise<EmbedPdfSurfaceModule>;

export type DocumentSurfaceProvider = (options: {
  requestPassword?: PdfPasswordRequester;
  getAnnotationDisplayName?: () => AnnotationDisplayName;
}) => DocumentSurfaceFactory;

export function resolveDocumentSurfaceKind(value: string | undefined): DocumentSurfaceKind {
  return value === 'embedpdf' ? 'embedpdf' : 'pdfjs';
}

export function createDevelopmentDocumentSurfaceProvider(
  value: string | undefined,
  loadEmbedPdf: LoadEmbedPdfSurface = () => import('./embedpdf-document-surface'),
  assessEditing?: (bytes: Uint8Array) => Promise<string | null>,
): DocumentSurfaceProvider | undefined {
  if (resolveDocumentSurfaceKind(value) !== 'embedpdf') return undefined;

  return ({ requestPassword, getAnnotationDisplayName }) => {
    let factory: Promise<DocumentSurfaceFactory> | null = null;
    return async (request) => {
      factory ??= loadEmbedPdf().then((module) =>
        module.createEmbedPdfDocumentSurfaceFactory({
          requestPassword,
          ...(getAnnotationDisplayName ? { getAnnotationDisplayName } : {}),
          ...(assessEditing ? { assessEditing } : {}),
        }),
      );
      return (await factory)(request);
    };
  };
}
