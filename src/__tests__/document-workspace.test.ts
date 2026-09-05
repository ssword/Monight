// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentWorkspace } from '../app/document-workspace';
import { createDocumentIntake, type DocumentRuntimeIntake } from '../reader/document-intake';
import type { DocumentRendering } from '../reader/document-rendering';
import {
  createReaderActions,
  type ReaderAction,
  type ReaderActions,
  type ReadingSessionSnapshot,
  type RestorableReadingPosition,
} from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const snapshot = (
  documents: ReadingSessionSnapshot['documents'],
  activeDocumentPath: string | null,
): ReadingSessionSnapshot => ({ schemaVersion: 2, revision: 1, activeDocumentPath, documents });

interface ControllableSurface {
  readonly rendering: DocumentRendering;
  readonly runtime: { destroy: ReturnType<typeof vi.fn> };
  visible(): boolean;
}

function createControllableSurface(
  filePath: string,
  failReadingPositionCall?: number,
): ControllableSurface {
  let currentPage = 1;
  let visible = false;
  let readingPositionCalls = 0;
  const runtime = { destroy: vi.fn(async () => undefined) };
  const rendering = {
    getState: () => ({
      currentPage,
      totalPages: 12,
      zoom: 1,
      zoomIntent: { kind: 'manual' as const, scale: 1 },
      rotation: 0,
      fileName: filePath.split('/').pop() ?? filePath,
      filePath,
      viewMode: 'single' as const,
    }),
    getReadingPosition: () => ({ page: currentPage, location: 0 }),
    applyFilter: vi.fn(),
    setRotation: vi.fn(async () => undefined),
    setViewMode: vi.fn(async () => undefined),
    setZoomIntent: vi.fn(async () => undefined),
    goToReadingPosition: vi.fn(async (position: RestorableReadingPosition) => {
      readingPositionCalls += 1;
      if (readingPositionCalls === failReadingPositionCall) {
        throw new Error('activation rendering failed');
      }
      currentPage = position.page;
    }),
    setVisible: vi.fn((nextVisible: boolean) => {
      visible = nextVisible;
    }),
    destroy: vi.fn(),
  } as unknown as DocumentRendering;
  return { rendering, runtime, visible: () => visible };
}

describe('Document workspace adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-container"></div>
      <div id="document-workspace"></div>
    `;
  });

  it('projects tab controls from Reading Session snapshots and dispatches semantic actions', async () => {
    const dispatch = vi.fn(async (_action: ReaderAction) => ({
      status: 'committed' as const,
      revision: 2,
    }));
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async () => {
        throw new Error('not used');
      }),
    });
    const readingSession = snapshot(
      [
        {
          filePath: '/docs/one.pdf',
          title: 'one.pdf',
          readingPosition: { page: 1, location: 0 },
          visualState: {
            filterSettings: PRESETS.default,
            zoomIntent: { kind: 'manual', scale: 1 },
            rotation: 0,
            viewMode: 'single',
          },
        },
        {
          filePath: '/docs/two.pdf',
          title: 'two.pdf',
          readingPosition: { page: 2, location: 0 },
          visualState: {
            filterSettings: PRESETS.default,
            zoomIntent: { kind: 'fit-width' },
            rotation: 0,
            viewMode: 'continuous',
          },
        },
      ],
      '/docs/two.pdf',
    );

    workspace.project(readingSession);

    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.dataset.filePath)).toEqual(['/docs/one.pdf', '/docs/two.pdf']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);

    tabs[0].click();
    document.querySelector<HTMLButtonElement>('[aria-label="Close one.pdf"]')?.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'activateDocument', filePath: '/docs/one.pdf' },
      { type: 'closeDocument', filePath: '/docs/one.pdf' },
    ]);
  });

  it('turns Document Intake into registration and activation Reader Actions', async () => {
    let current = snapshot([], null);
    const rendering = {
      applyFilter: vi.fn(),
      setRotation: vi.fn(async () => undefined),
      setViewMode: vi.fn(async () => undefined),
      setZoomIntent: vi.fn(async () => undefined),
      goToReadingPosition: vi.fn(async () => undefined),
      getReadingPosition: vi.fn(() => ({ page: 4, location: 0 })),
      setVisible: vi.fn(),
      destroy: vi.fn(),
    } as unknown as DocumentRendering;
    const runtime = { destroy: vi.fn(async () => undefined) };
    const dispatched: ReaderAction[] = [];
    const dispatch = vi.fn(async (action: ReaderAction) => {
      dispatched.push(action);
      if (action.type === 'registerDocument') {
        current = snapshot([...current.documents, action.document], current.activeDocumentPath);
      }
      if (action.type === 'activateDocument') {
        current = snapshot(current.documents, action.filePath);
      }
      return { status: 'committed' as const, revision: current.revision };
    });
    const createSurface = vi.fn(async () => ({ rendering, runtime: runtime as never }));
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      snapshot: () => current,
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface,
    });

    const bytes = new Uint8Array([1, 2, 3]);
    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/report.pdf', title: 'report.pdf' },
      bytes,
      activate: true,
      initialPage: 4,
    });

    expect(createSurface).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/docs/report.pdf', title: 'report.pdf', bytes }),
    );
    expect(dispatched.map(({ type }) => type)).toEqual(['registerDocument']);
    expect(dispatched[0]).toMatchObject({
      type: 'registerDocument',
      activate: true,
      document: {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        readingPosition: { page: 4, location: 0 },
      },
    });
  });

  it('does not treat an unrestored Reading Session entry as a live Document runtime', () => {
    const savedDocument = {
      filePath: '/docs/saved.pdf',
      title: 'saved.pdf',
      readingPosition: { page: 3, location: 0.25 },
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: vi.fn(async () => ({ status: 'no-op' as const, revision: 0 })),
      snapshot: () => snapshot([savedDocument], '/docs/saved.pdf'),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async () => {
        throw new Error('not used');
      }),
    });

    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(false);
  });

  it('publishes a new Document only after activation succeeds and permits a clean retry', async () => {
    const persist = vi.fn(async () => undefined);
    const documentOpened = vi.fn();
    const reopenDocument = vi.fn(async () => undefined);
    const createdSurfaces = new Map<string, ControllableSurface[]>();
    let candidateAttempts = 0;
    let presentationActive = false;
    let reader: ReaderActions;
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: null,
      documents: [],
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action) => reader.dispatch(action),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (filePath) => reader?.isDocumentOpen(filePath) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async ({ filePath }) => {
        if (filePath === '/docs/candidate.pdf') candidateAttempts += 1;
        const surface = createControllableSurface(
          filePath,
          filePath === '/docs/render-fails.pdf'
            ? 1
            : filePath === '/docs/candidate.pdf' && candidateAttempts === 1
              ? 2
              : undefined,
        );
        const attempts = createdSurfaces.get(filePath) ?? [];
        attempts.push(surface);
        createdSurfaces.set(filePath, attempts);
        return { rendering: surface.rendering, runtime: surface.runtime as never };
      }),
      documentOpened,
    });
    reader = createReaderActions({
      initialSession,
      projection: {
        ...workspace.projection,
        exitPresentation: async () => {
          const wasActive = presentationActive;
          presentationActive = false;
          return wasActive
            ? async () => {
                presentationActive = true;
              }
            : undefined;
        },
      },
      persist,
      reopenDocument,
    });
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({ canonicalPath: path, title: path.split('/').pop() ?? path }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: workspace.intakeRuntime,
    });

    await expect(intake.open(['/docs/prior.pdf'])).resolves.toMatchObject({
      opened: 1,
      failed: 0,
    });
    const settledBeforeFailure = reader.snapshot();
    const durableWritesBeforeFailure = persist.mock.calls.length;
    presentationActive = true;

    await expect(intake.open(['/docs/candidate.pdf'])).resolves.toMatchObject({
      opened: 0,
      failed: 1,
    });

    const failedSurface = createdSurfaces.get('/docs/candidate.pdf')?.[0];
    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).toHaveBeenCalledTimes(durableWritesBeforeFailure);
    expect(workspace.intakeRuntime.isOpen('/docs/candidate.pdf')).toBe(false);
    expect(reader.query('/docs/candidate.pdf')).toBeNull();
    expect(workspace.activeRenderingState()?.filePath).toBe('/docs/prior.pdf');
    expect(presentationActive).toBe(true);
    expect(createdSurfaces.get('/docs/prior.pdf')?.[0]?.visible()).toBe(true);
    expect(failedSurface?.visible()).toBe(false);
    expect(failedSurface?.rendering.destroy).toHaveBeenCalledOnce();
    expect(failedSurface?.runtime.destroy).toHaveBeenCalledOnce();
    expect(documentOpened).toHaveBeenCalledTimes(1);
    await expect(reader.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'no-op',
    });
    expect(reopenDocument).not.toHaveBeenCalled();

    await expect(intake.open(['/docs/candidate.pdf'])).resolves.toMatchObject({
      opened: 1,
      failed: 0,
    });

    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/candidate.pdf',
      documents: [{ filePath: '/docs/prior.pdf' }, { filePath: '/docs/candidate.pdf' }],
    });
    expect(workspace.intakeRuntime.isOpen('/docs/candidate.pdf')).toBe(true);
    expect(workspace.activeRenderingState()?.filePath).toBe('/docs/candidate.pdf');
    expect(presentationActive).toBe(false);
    expect(createdSurfaces.get('/docs/prior.pdf')?.[0]?.visible()).toBe(false);
    expect(createdSurfaces.get('/docs/candidate.pdf')?.[1]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(2);

    await expect(intake.open(['/docs/background.pdf'], { activate: false })).resolves.toMatchObject(
      { opened: 1, failed: 0 },
    );

    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/candidate.pdf',
      documents: [
        { filePath: '/docs/prior.pdf' },
        { filePath: '/docs/candidate.pdf' },
        { filePath: '/docs/background.pdf' },
      ],
    });
    expect(workspace.intakeRuntime.isOpen('/docs/background.pdf')).toBe(true);
    expect(reader.query('/docs/background.pdf')).not.toBeNull();
    expect(createdSurfaces.get('/docs/background.pdf')?.[0]?.visible()).toBe(false);
    expect(createdSurfaces.get('/docs/candidate.pdf')?.[1]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(3);

    const settledBeforeMixedIntake = reader.snapshot();
    const durableWritesBeforeMixedIntake = persist.mock.calls.length;
    const mixedResult = await intake.open([
      '/docs/render-fails.pdf',
      '/docs/successful-sibling.pdf',
    ]);

    expect(mixedResult.outcomes.map(({ status }) => status)).toEqual(['failed', 'opened']);
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/successful-sibling.pdf',
      documents: [
        { filePath: '/docs/prior.pdf' },
        { filePath: '/docs/candidate.pdf' },
        { filePath: '/docs/background.pdf' },
        { filePath: '/docs/successful-sibling.pdf' },
      ],
    });
    expect(reader.snapshot().revision).toBe(settledBeforeMixedIntake.revision + 1);
    expect(persist).toHaveBeenCalledTimes(durableWritesBeforeMixedIntake + 1);
    expect(workspace.intakeRuntime.isOpen('/docs/render-fails.pdf')).toBe(false);
    expect(reader.query('/docs/render-fails.pdf')).toBeNull();
    expect(
      createdSurfaces.get('/docs/render-fails.pdf')?.[0]?.rendering.destroy,
    ).toHaveBeenCalledOnce();
    expect(
      createdSurfaces.get('/docs/render-fails.pdf')?.[0]?.runtime.destroy,
    ).toHaveBeenCalledOnce();
    expect(createdSurfaces.get('/docs/successful-sibling.pdf')?.[0]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(4);
  });

  it('keeps a failed saved Document provisional until restoration can retry it', async () => {
    const persist = vi.fn(async () => undefined);
    const documentOpened = vi.fn();
    const savedDocument = {
      filePath: '/docs/saved.pdf',
      title: 'saved.pdf',
      readingPosition: { page: 6, location: 0.25 },
      visualState: {
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' as const },
        rotation: 90,
        viewMode: 'continuous' as const,
      },
    };
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: savedDocument.filePath,
      documents: [savedDocument],
    };
    let reader: ReaderActions;
    let attempts = 0;
    const surfaces: ControllableSurface[] = [];
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action) => reader.dispatch(action),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (filePath) => reader?.isDocumentOpen(filePath) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async ({ filePath }) => {
        attempts += 1;
        const surface = createControllableSurface(filePath, attempts === 1 ? 2 : undefined);
        surfaces.push(surface);
        return { rendering: surface.rendering, runtime: surface.runtime as never };
      }),
      documentOpened,
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist,
    });
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({ canonicalPath: path, title: 'saved.pdf' }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: {
        ...workspace.intakeRuntime,
        canonicalizeDocumentPaths: async (paths) => {
          const outcome = await reader.canonicalizeDocumentPaths(paths);
          if (outcome.status === 'failure') throw outcome.error;
        },
        setDocumentOrder: () => undefined,
      },
    });
    const settledBeforeFailure = reader.snapshot();

    await expect(intake.restore(initialSession)).resolves.toMatchObject({
      opened: 0,
      failed: 1,
      failedPaths: ['/docs/saved.pdf'],
    });

    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).not.toHaveBeenCalled();
    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(false);
    expect(reader.query('/docs/saved.pdf')).toBeNull();
    expect(surfaces[0]?.rendering.destroy).toHaveBeenCalledOnce();
    expect(surfaces[0]?.runtime.destroy).toHaveBeenCalledOnce();
    expect(documentOpened).not.toHaveBeenCalled();

    await expect(intake.restore(initialSession)).resolves.toMatchObject({
      opened: 1,
      failed: 0,
      failedPaths: [],
    });

    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).not.toHaveBeenCalled();
    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(true);
    expect(reader.query('/docs/saved.pdf')).not.toBeNull();
    expect(surfaces[1]?.visible()).toBe(true);
    expect(documentOpened).not.toHaveBeenCalled();
  });
});

// Compile-time contract: the workspace provides the runtime consumed by Document Intake,
// without exposing a mutable tab/session model.
const acceptsIntakeRuntime = (_runtime: DocumentRuntimeIntake): void => undefined;
void acceptsIntakeRuntime;
