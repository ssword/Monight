import { LockModeType, type PDFViewerConfig, type UISchema } from '@embedpdf/snippet';
import {
  type AnnotationDisplayName,
  DEFAULT_ANNOTATION_DISPLAY_NAME,
} from '../reader/native-pdf-editing';
import { VERIFIED_MARKUP_TOOLS } from './markup-tools';

const EMBEDPDF_WASM_URL = '/embedpdf/pdfium.wasm';
const EMBEDPDF_FONT_BASE_URL = '/embedpdf/fonts';

/** EmbedPDF tools Monight enables: exactly the verified markup tools. */
export function embedPdfAnnotationToolIds(): readonly string[] {
  return VERIFIED_MARKUP_TOOLS.map(({ id }) => id);
}

/**
 * The ready-made viewer's interface, emptied: no toolbar, page controls,
 * sidebar, panel, menu, modal, or text/annotation selection menu is rendered.
 * Monight's reader chrome replaces every part of it (ADR 0003); EmbedPDF keeps
 * rendering the pages and their annotation layer.
 */
const HEADLESS_UI_SCHEMA: UISchema = {
  id: 'monight-headless',
  version: '1',
  toolbars: {},
  menus: {},
  sidebars: {},
  modals: {},
  overlays: {},
  selectionMenus: {},
};

/**
 * EmbedPDF features (commands, their shortcuts, and tools) Monight does not
 * offer, or offers through its own Reader Commands instead.
 */
const DISABLED_CATEGORIES = [
  'annotation',
  'redaction',
  'insert',
  'document-open',
  'document-close',
  'document-print',
  'document-export',
  'document-protect',
  'document-capture',
  // Rotation is a Page Rotation edit of the PDF, never a view setting.
  'rotate',
  // Monight's zoom group and View ▸ zoom commands own zooming.
  'zoom',
  // Monight's sidebar owns thumbnails and the outline.
  'panel-sidebar',
  // Monight's toolbar Search field and sidebar own search.
  'panel-search',
  // Reading Session supports single, continuous, and odd-page spreads.
  'spread-even',
  // Monight's markup toolbar and Highlight split button own the annotation tools.
  'mode-annotate',
] as const;

const localFontFallback = {
  baseUrl: EMBEDPDF_FONT_BASE_URL,
  fonts: {
    0: 'MonightMultiscriptFallback-Regular.ttf',
    1: 'NotoSans-Regular.ttf',
    128: 'NotoSansJP-Regular.otf',
    129: 'NotoSansKR-Regular.otf',
    134: 'NotoSansHans-Regular.otf',
    136: 'NotoSansHant-Regular.otf',
    161: 'NotoSans-Regular.ttf',
    163: 'NotoSans-Regular.ttf',
    177: 'NotoSansHebrew-Regular.ttf',
    178: 'NotoNaskhArabic-Regular.ttf',
    204: 'NotoSans-Regular.ttf',
    238: 'NotoSans-Regular.ttf',
  },
};

type LocalFontLoader = (fontPath: string) => Uint8Array | null;

const localFontUrls = [...new Set(Object.values(localFontFallback.fonts))].map(
  (fileName) => `${EMBEDPDF_FONT_BASE_URL}/${fileName}`,
);

let localFontData: Promise<Map<string, Uint8Array>> | null = null;

export async function preloadEmbedPdfLocalFonts(): Promise<Map<string, Uint8Array>> {
  localFontData ??= Promise.all(
    localFontUrls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`EmbedPDF font request failed: ${response.status} ${url}`);
      return [url, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  ).then((entries) => new Map(entries));
  try {
    return await localFontData;
  } catch (error) {
    localFontData = null;
    throw error;
  }
}

export function createEmbedPdfViewerConfig(
  fontLoader?: LocalFontLoader,
  editable = false,
  annotationDisplayName: AnnotationDisplayName = DEFAULT_ANNOTATION_DISPLAY_NAME,
): PDFViewerConfig {
  return {
    worker: false,
    wasmUrl: EMBEDPDF_WASM_URL,
    tabBar: 'never',
    ui: { schema: HEADLESS_UI_SCHEMA },
    fontFallback: {
      ...localFontFallback,
      ...(fontLoader ? { fontLoader } : {}),
    },
    stamp: { manifests: [], defaultLibrary: false },
    fonts: {
      ui: { family: 'system-ui, sans-serif', stylesheetUrl: null },
      signature: null,
    },
    disabledCategories: [
      ...DISABLED_CATEGORIES.filter((category) => !editable || category !== 'annotation'),
      'form',
      'signature',
      'annotation-ink',
      'annotation-shape',
      'annotation-text',
      'annotation-underline',
      'annotation-strikeout',
      'annotation-squiggly',
      'annotation-insert-text',
      'annotation-replace-text',
      'annotation-link',
      'annotation-group',
      'annotation-widget-edit',
    ],
    permissions: {
      enforceDocumentPermissions: true,
      overrides: {
        modifyContents: false,
        ...(editable ? {} : { modifyAnnotations: false }),
        fillForms: false,
        assembleDocument: false,
      },
    },
    render: { withAnnotations: true, withForms: false },
    annotations: {
      autoOpenLinks: false,
      annotationAuthor: annotationDisplayName,
      autoCommit: false,
      tools: embedPdfAnnotationToolIds().map((id) => ({
        id,
        categories: ['monight-native'],
      })),
      locked: editable
        ? { type: LockModeType.Exclude, categories: ['monight-native'] }
        : { type: LockModeType.All },
    },
    form: { withForms: false, withAnnotations: true },
  };
}
