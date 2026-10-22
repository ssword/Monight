import type {
  AnnotationCapability,
  EmbedPdfContainer,
  PdfAnnotationObject,
  Rect,
} from '@embedpdf/snippet';
import { LockModeType, PdfAnnotationSubtype } from '@embedpdf/snippet';
import manifest from '../src-tauri/tests/fixtures/external/manifest.json';
import { loadChromePreferences } from './app/chrome-preferences';
import type { DocumentSurface } from './app/document-workspace';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';
import { createReaderSidebar } from './app/reader-sidebar';
import { createDocumentQuery, type DocumentAnnotationKind } from './reader/document-queries';
import type { ReaderAction } from './reader/reader-actions';
import { PRESETS } from './scripts/filters';

// External-reader-to-Monight contract (#79): every reader registered in the external
// fixture manifest is opened with the pinned runtime, its externally authored Annotations are
// checked as native objects, then edited, deleted, and exported for the native preservation
// contract in src-tauri/src/external_reader_contract.rs.
// Highlights and Notes (#107) is checked against the same fixtures: the sidebar must list
// exactly the inventory's text markups and notes, by page, from every author, follow each
// edit, deletion and creation, and navigate to and reveal an entry when it is clicked.

interface Selector {
  readonly subtype: string;
  readonly contents: string;
  readonly author: string;
}

interface InventoryAnnotation {
  readonly Subtype: string;
  readonly Contents?: string;
  readonly T?: string;
  readonly Rect: readonly number[];
  readonly QuadPoints?: readonly number[];
}

interface InventoryFile {
  readonly pages: readonly {
    readonly mediaBox: readonly number[];
    readonly annotations: readonly InventoryAnnotation[];
  }[];
}

interface KnownGeometryFailure extends Selector {
  readonly stage: string;
  readonly Rect: readonly number[];
  readonly failure: string;
}

interface ExpectedAnnotation {
  readonly selector: Selector;
  readonly pageIndex: number;
  readonly pageHeight: number;
  readonly rect: Rect;
  readonly segmentRects?: Rect[];
}

type Reader = (typeof manifest.readers)[number];

export interface ExternalReaderExports {
  readonly id: string;
  readonly knownFailures: string[];
  /** Exported bytes by stage: edited, deleted, and unsupported-* for an editable unsupported fixture. */
  readonly files: Record<string, number[]>;
}

declare global {
  interface Window {
    externalReaderSmoke?: ExternalReaderExports[];
  }
}

const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

const files = manifest.files as Record<string, InventoryFile>;

function subtypeOf(name: string): PdfAnnotationSubtype {
  const subtype = PdfAnnotationSubtype[name.replace('/', '').toUpperCase() as 'TEXT'];
  if (subtype === undefined) throw new Error(`Unknown Annotation subtype ${name}`);
  return subtype;
}

const sameSelector = (a: Selector, b: Selector) =>
  a.subtype === b.subtype && a.contents === b.contents && a.author === b.author;

/** Converts a PDF-space rectangle (bottom-left origin) to EmbedPDF page space. */
function pageRect([left, bottom, right, top]: readonly number[], pageHeight: number): Rect {
  return {
    origin: { x: left, y: pageHeight - top },
    size: { width: right - left, height: top - bottom },
  };
}

function quadRects(quadPoints: readonly number[], pageHeight: number): Rect[] {
  const rects: Rect[] = [];
  for (let index = 0; index < quadPoints.length; index += 8) {
    const [x1, y1, x2, , , y3] = quadPoints.slice(index, index + 8);
    rects.push(pageRect([x1, y3, x2, y1], pageHeight));
  }
  return rects;
}

function near(actual: Rect | undefined, expected: Rect, tolerance: number): boolean {
  if (!actual) return false;
  return [
    actual.origin.x - expected.origin.x,
    actual.origin.y - expected.origin.y,
    actual.size.width - expected.size.width,
    actual.size.height - expected.size.height,
  ].every((delta) => Math.abs(delta) <= tolerance);
}

function expectedAnnotations(
  fixture: string,
  selectors: readonly Selector[],
): ExpectedAnnotation[] {
  return selectors.map((selector) => {
    for (const [pageIndex, page] of files[fixture].pages.entries()) {
      const pageHeight = page.mediaBox[3] - page.mediaBox[1];
      const entry = page.annotations.find((annotation) =>
        sameSelector(
          {
            subtype: annotation.Subtype,
            contents: annotation.Contents ?? '',
            author: annotation.T ?? '',
          },
          selector,
        ),
      );
      if (entry)
        return {
          selector,
          pageIndex,
          pageHeight,
          rect: pageRect(entry.Rect, pageHeight),
          segmentRects: entry.QuadPoints && quadRects(entry.QuadPoints, pageHeight),
        };
    }
    throw new Error(`${fixture} inventory has no ${JSON.stringify(selector)}`);
  });
}

const LISTED_SUBTYPES: Readonly<Record<string, DocumentAnnotationKind>> = {
  '/Highlight': 'highlight',
  '/Underline': 'underline',
  '/StrikeOut': 'strikeout',
  '/Squiggly': 'squiggly',
  '/Text': 'note',
};

const LISTED_TYPES = [
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
  PdfAnnotationSubtype.TEXT,
];

const listingEntry = (page: number, kind: string, contents: string, author: string) =>
  JSON.stringify([page, kind, contents, author]);

/** The fixture inventory's Highlights and Notes, as an independent source of truth. */
function inventoryListing(fixture: string): string[] {
  return files[fixture].pages
    .flatMap((page, pageIndex) =>
      page.annotations
        .filter((annotation) => annotation.Subtype in LISTED_SUBTYPES)
        .map((annotation) =>
          listingEntry(
            pageIndex + 1,
            LISTED_SUBTYPES[annotation.Subtype],
            annotation.Contents ?? '',
            annotation.T ?? '',
          ),
        ),
    )
    .sort();
}

const surfaceListing = (surface: DocumentSurface): string[] =>
  (surface.runtime.annotations?.() ?? [])
    .map(({ pageNumber, kind, contents, author }) =>
      listingEntry(pageNumber, kind, contents, author),
    )
    .sort();

function checkListing(surface: DocumentSurface, expected: string[], label: string): void {
  const actual = surfaceListing(surface);
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} Highlights and Notes ${JSON.stringify(actual)} differ from ${JSON.stringify(expected)}`,
  );
}

/** The listing after the selected Annotations change contents (or, with null, are deleted). */
function replaceListed(
  listing: readonly string[],
  expected: readonly ExpectedAnnotation[],
  contents: (annotation: ExpectedAnnotation) => string | null,
): string[] {
  const result = [...listing];
  for (const annotation of expected) {
    const { subtype, contents: original, author } = annotation.selector;
    const kind = LISTED_SUBTYPES[subtype];
    const index = result.indexOf(listingEntry(annotation.pageIndex + 1, kind, original, author));
    check(index >= 0, `Inventory listing lacks ${JSON.stringify(annotation.selector)}`);
    const next = contents(annotation);
    result.splice(
      index,
      1,
      ...(next === null ? [] : [listingEntry(annotation.pageIndex + 1, kind, next, author)]),
    );
  }
  return result.sort();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Mounts the real Highlights and Notes sidebar over a live surface. */
async function mountHighlightsAndNotes(surface: DocumentSurface) {
  const host = document.createElement('div');
  host.innerHTML = `
    <button data-smoke="toggle" type="button"></button>
    <button data-smoke="mode-toggle" type="button"></button>
    <div data-smoke="mode-menu" class="hidden"></div>
    <aside data-smoke="sidebar" hidden><div class="reader-sidebar-content"></div></aside>
  `;
  document.body.append(host);
  const element = <T extends HTMLElement>(name: string) =>
    host.querySelector(`[data-smoke="${name}"]`) as T;
  const preferences = await loadChromePreferences(
    {
      read: async () => ({ schemaVersion: 1, sidebarVisible: true, sidebarMode: 'annotations' }),
      write: async () => undefined,
    },
    { debounceMs: 0 },
  );
  const dispatched: ReaderAction[] = [];
  const filePath = '/external-reader.pdf';
  const query = createDocumentQuery({
    filePath,
    generation: 1,
    runtime: surface.runtime,
    isCurrent: () => true,
  });
  const sidebar = createReaderSidebar({
    elements: {
      root: element('sidebar'),
      toggle: element<HTMLButtonElement>('toggle'),
      modeToggle: element<HTMLButtonElement>('mode-toggle'),
      modeMenu: element('mode-menu'),
    },
    preferences,
    activeDocument: () => ({
      filePath,
      pageCount: surface.rendering.getState().totalPages,
      currentPage: surface.rendering.getState().currentPage,
      filterSettings: PRESETS.default,
      query,
    }),
    dispatchReaderAction: async (action) => {
      dispatched.push(action);
      if (action.type === 'activateDocumentTarget' && action.target.readingPosition)
        await surface.rendering.goToReadingPosition(action.target.readingPosition);
    },
    revealAnnotation: (_filePath, annotationId) =>
      surface.rendering.revealAnnotation?.(annotationId),
  });
  const refresh = async () => {
    sidebar.refresh();
    await settle();
  };
  await refresh();
  return {
    dispatched,
    refresh,
    entries: () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.sidebar-annotation')).map((button) => ({
        button,
        id: button.dataset.annotationId ?? '',
        page: button.closest('.sidebar-annotation-page')?.querySelector('h3')?.textContent,
        text: button.querySelector('.sidebar-annotation-text')?.textContent ?? '',
      })),
    destroy() {
      sidebar.destroy();
      host.remove();
    },
  };
}

async function waitForSelection(annotations: AnnotationCapability, id: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (annotations.getSelectedAnnotations().some(({ object }) => object.id === id)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Annotation ${id} was not revealed`);
}

/** Whether the Annotation's rect lies inside the visible part of its page. */
async function annotationInView(object: PdfAnnotationObject): Promise<boolean> {
  const container = document.querySelector<EmbedPdfContainer>('embedpdf-container');
  const scroll = (await container?.registry)
    ?.getPlugin<import('@embedpdf/snippet').ScrollPlugin>('scroll')
    ?.provides();
  if (!scroll) throw new Error('Missing scroll capability');
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const visible = scroll
      .getMetrics()
      .pageVisibilityMetrics.find(({ pageNumber }) => pageNumber === object.pageIndex + 1);
    if (
      visible &&
      visible.original.pageY <= object.rect.origin.y + 1 &&
      object.rect.origin.y + object.rect.size.height <=
        visible.original.pageY + visible.original.visibleHeight + 1
    )
      return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/** Clicks each selected Annotation's sidebar entry; it must be navigated to and selected. */
async function verifySidebarNavigation(
  reader: Reader,
  annotations: AnnotationCapability,
  expected: readonly ExpectedAnnotation[],
  sidebar: Awaited<ReturnType<typeof mountHighlightsAndNotes>>,
): Promise<void> {
  for (const annotation of expected) {
    const [object] = find(annotations, annotation);
    const entry = sidebar.entries().find(({ id }) => id === object?.id);
    if (!object || !entry)
      throw new Error(`${reader.id} sidebar lacks ${annotation.selector.subtype}`);
    check(
      entry.page === `Page ${annotation.pageIndex + 1}`,
      `${reader.id} sidebar groups ${annotation.selector.subtype} under ${entry.page}`,
    );
    check(
      entry.text === annotation.selector.contents,
      `${reader.id} sidebar shows "${entry.text}" for ${annotation.selector.subtype}`,
    );
    annotations.deselectAnnotation();
    sidebar.dispatched.length = 0;
    entry.button.click();
    await waitForSelection(annotations, object.id);
    const [action] = sidebar.dispatched;
    check(
      action?.type === 'activateDocumentTarget' &&
        action.target.readingPosition?.page === annotation.pageIndex + 1,
      `${reader.id} sidebar did not navigate to ${annotation.selector.subtype}`,
    );
    check(
      await annotationInView(object),
      `${reader.id} sidebar did not scroll ${annotation.selector.subtype} into view`,
    );
  }
}

async function open(
  bytes: Uint8Array,
  readOnlyReason: string | null = null,
): Promise<{
  surface: DocumentSurface;
  annotations: AnnotationCapability;
}> {
  const surface = await createEmbedPdfDocumentSurfaceFactory({
    assessEditing: async () => readOnlyReason,
  })({
    filePath: '/external-reader.pdf',
    title: 'external-reader.pdf',
    bytes,
    callbacks: {
      readingPositionObserved() {},
      readingPositionSettled() {},
      stateChanged() {},
      pageNavigationRequested: async () => undefined,
      zoomIntentRequested: async () => undefined,
    },
  });
  surface.rendering.setVisible(true);
  const container = document.querySelector<EmbedPdfContainer>('embedpdf-container');
  if (!container) throw new Error('Missing ready-made viewer');
  const annotations = (await container.registry)
    .getPlugin<import('@embedpdf/snippet').AnnotationPlugin>('annotation')
    ?.provides();
  if (!annotations) throw new Error('Missing native annotation capability');
  // Disposable interoperability harness only: keep exercising native Highlight
  // edits while #124 suspends its production interaction/creation tools. The
  // annotations smoke suite independently checks the production locks.
  if (readOnlyReason === null) annotations.setLocked({ type: LockModeType.None });

  return { surface, annotations };
}

const objects = (annotations: AnnotationCapability) =>
  annotations.getAnnotations().map(({ object }) => object);

const edited = (contents: string) => `Monight edited ${contents}`;

/** Matches the selected Annotation before or, with `contents`, after a Monight edit. */
function matches(
  object: PdfAnnotationObject,
  { pageIndex, selector }: ExpectedAnnotation,
  contents = selector.contents,
): boolean {
  return (
    object.pageIndex === pageIndex &&
    object.type === subtypeOf(selector.subtype) &&
    object.contents === contents &&
    object.author === selector.author
  );
}

function find(
  annotations: AnnotationCapability,
  expected: ExpectedAnnotation,
  contents?: string,
): PdfAnnotationObject[] {
  return objects(annotations).filter((object) => matches(object, expected, contents));
}

function checkGeometry(
  object: PdfAnnotationObject,
  expected: ExpectedAnnotation,
  tolerance: number,
  stage: string,
): void {
  const label = `${stage} ${expected.selector.subtype} "${expected.selector.contents}"`;
  check(
    near(object.rect, expected.rect, tolerance),
    `${label} rect ${JSON.stringify(object.rect)} differs from ${JSON.stringify(expected.rect)}`,
  );
  if (!expected.segmentRects) return;
  const segments = 'segmentRects' in object ? object.segmentRects : undefined;
  check(
    segments?.length === expected.segmentRects.length &&
      segments.every((segment, index) =>
        near(segment, expected.segmentRects?.[index] as Rect, tolerance),
      ),
    `${label} segments ${JSON.stringify(segments)} differ from ${JSON.stringify(expected.segmentRects)}`,
  );
}

/** Edits, then deletes, the selected Annotations of `fixture`; returns both exports. */
async function verifyFixture(
  reader: Reader,
  fixture: string,
  knownFailures: string[],
): Promise<{ edited: Uint8Array; deleted: Uint8Array }> {
  const tolerance = reader.geometryTolerancePoints;
  const knownGeometryFailures: readonly KnownGeometryFailure[] =
    'knownGeometryFailures' in reader ? reader.knownGeometryFailures : [];
  // A registered failure pins the observed broken geometry instead of the input geometry, so
  // the contract still fails when an upgrade fixes or changes it and the entry must be revisited.
  const expectedAfter = (stage: string, annotation: ExpectedAnnotation): ExpectedAnnotation => {
    const known = knownGeometryFailures.find(
      (failure) => failure.stage === stage && sameSelector(failure, annotation.selector),
    );
    if (!known) return annotation;
    knownFailures.push(`${known.failure} (${stage})`);
    return {
      ...annotation,
      rect: pageRect(known.Rect, annotation.pageHeight),
      segmentRects: undefined,
    };
  };
  const expected = expectedAnnotations(fixture, reader.annotationSelectors);
  const response = await fetch(
    new URL(`../src-tauri/tests/fixtures/external/${fixture}`, import.meta.url),
  );
  check(response.ok, `External fixture could not be loaded: ${fixture}`);
  const input = new Uint8Array(await response.arrayBuffer());
  const otherAnnotations = (annotations: AnnotationCapability) =>
    objects(annotations)
      .filter(
        (object) =>
          !expected.some(
            (annotation) =>
              matches(object, annotation) ||
              matches(object, annotation, edited(annotation.selector.contents)),
          ),
      )
      .map(({ type, contents, author, pageIndex }) => ({ type, contents, author, pageIndex }));

  const listing = inventoryListing(fixture);
  let { surface, annotations } = await open(input);
  check(!surface.runtime.editing?.state().readOnlyReason, `${reader.id} opened read-only`);
  const untouched = otherAnnotations(annotations);
  checkListing(surface, listing, `${reader.id} input`);
  const sidebar = await mountHighlightsAndNotes(surface);
  await verifySidebarNavigation(reader, annotations, expected, sidebar);
  for (const annotation of expected) {
    const found = find(annotations, annotation);
    check(
      found.length === 1,
      `${reader.id} lacks one native ${JSON.stringify(annotation.selector)}`,
    );
    const [object] = found;
    checkGeometry(object, annotation, tolerance, `${reader.id} input`);
    annotations.selectAnnotation(annotation.pageIndex, object.id);
    check(
      annotations.getSelectedAnnotations().some((selected) => selected.object.id === object.id),
      `${reader.id} ${annotation.selector.subtype} is not selectable`,
    );
    annotations.updateAnnotation(annotation.pageIndex, object.id, {
      contents: edited(annotation.selector.contents),
    });
  }
  const editedListing = replaceListed(listing, expected, (annotation) =>
    edited(annotation.selector.contents),
  );
  checkListing(surface, editedListing, `${reader.id} live edit`);
  await sidebar.refresh();
  for (const annotation of expected) {
    check(
      sidebar.entries().some(({ text }) => text === edited(annotation.selector.contents)),
      `${reader.id} sidebar did not follow the edit of ${annotation.selector.subtype}`,
    );
  }
  sidebar.destroy();
  const editedBytes = await surface.runtime.editing?.exportPdf();
  if (!editedBytes) throw new Error(`${reader.id} edit export failed`);
  await surface.runtime.destroy();

  ({ surface, annotations } = await open(editedBytes));
  check(
    JSON.stringify(otherAnnotations(annotations)) === JSON.stringify(untouched),
    `${reader.id} edit changed unrelated Annotations`,
  );
  checkListing(surface, editedListing, `${reader.id} edited`);
  for (const annotation of expected) {
    const found = find(annotations, annotation, edited(annotation.selector.contents));
    check(found.length === 1, `${reader.id} edit of ${annotation.selector.subtype} was lost`);
    checkGeometry(found[0], expectedAfter('edited', annotation), tolerance, `${reader.id} edited`);
    annotations.deleteAnnotation(annotation.pageIndex, found[0].id);
  }
  const deletedListing = replaceListed(listing, expected, () => null);
  checkListing(surface, deletedListing, `${reader.id} live deletion`);
  const deletedBytes = await surface.runtime.editing?.exportPdf();
  if (!deletedBytes) throw new Error(`${reader.id} deletion export failed`);
  await surface.runtime.destroy();

  ({ surface, annotations } = await open(deletedBytes));
  checkListing(surface, deletedListing, `${reader.id} deleted`);
  for (const annotation of expected) {
    check(
      find(annotations, annotation, edited(annotation.selector.contents)).length === 0,
      `${reader.id} deleted ${annotation.selector.subtype} survived re-save`,
    );
  }
  check(
    JSON.stringify(otherAnnotations(annotations)) === JSON.stringify(untouched),
    `${reader.id} deletion changed unrelated Annotations`,
  );
  await surface.runtime.destroy();

  // A new Monight note appears in the sidebar as soon as it is created.
  ({ surface, annotations } = await open(input));
  const creation = await mountHighlightsAndNotes(surface);
  annotations.createAnnotation(0, {
    id: 'monight-sidebar-note',
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: 0,
    rect: { origin: { x: 300, y: 300 }, size: { width: 24, height: 24 } },
    contents: 'Monight sidebar note',
  });
  await creation.refresh();
  check(
    creation
      .entries()
      .some(({ id, text }) => id === 'monight-sidebar-note' && text === 'Monight sidebar note'),
    `${reader.id} sidebar did not list a newly created note`,
  );
  creation.destroy();
  await surface.runtime.destroy();
  return { edited: editedBytes, deleted: deletedBytes };
}

/** Read-only Documents still list their Highlights and Notes, never other kinds. */
async function verifyUnsupportedListing(reader: Reader): Promise<void> {
  const fixture = reader.unsupportedFixture;
  const response = await fetch(
    new URL(`../src-tauri/tests/fixtures/external/${fixture}`, import.meta.url),
  );
  check(response.ok, `External fixture could not be loaded: ${fixture}`);
  const { surface, annotations } = await open(
    new Uint8Array(await response.arrayBuffer()),
    reader.unsupportedReason,
  );
  const unlisted = objects(annotations).filter((object) => !LISTED_TYPES.includes(object.type));
  check(
    unlisted.some(
      (object) =>
        object.type !== PdfAnnotationSubtype.POPUP && object.type !== PdfAnnotationSubtype.LINK,
    ),
    `${fixture} has no other Annotation kind to leave out`,
  );
  checkListing(surface, inventoryListing(fixture), `${reader.id} unsupported`);
  const ids = new Set((surface.runtime.annotations?.() ?? []).map(({ id }) => id));
  check(
    unlisted.every((object) => !ids.has(object.id)),
    `${reader.id} listed an Annotation kind outside Highlights and Notes`,
  );
  await surface.runtime.destroy();
}

async function verifyReader(reader: Reader): Promise<ExternalReaderExports> {
  const knownFailures: string[] = [];
  const files: Record<string, number[]> = {};
  const supported = await verifyFixture(reader, reader.supportedFixture, knownFailures);
  await verifyUnsupportedListing(reader);
  files.edited = Array.from(supported.edited);
  files.deleted = Array.from(supported.deleted);
  // A read-only unsupported fixture is asserted natively; an editable one must also round-trip.
  if (reader.unsupportedObservedClassification === 'editable') {
    const unsupported = await verifyFixture(reader, reader.unsupportedFixture, knownFailures);
    files['unsupported-edited'] = Array.from(unsupported.edited);
    files['unsupported-deleted'] = Array.from(unsupported.deleted);
  }
  return { id: reader.id, knownFailures, files };
}

async function run() {
  const exports: ExternalReaderExports[] = [];
  for (const reader of manifest.readers) exports.push(await verifyReader(reader));
  window.externalReaderSmoke = exports;
  document.body.dataset.status = 'ready';
}

void run().catch((error) => {
  document.body.dataset.status = 'failed';
  document.body.dataset.error = String(error);
  console.error(error);
});
