// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentWorkspace } from '../app/document-workspace';
import type { DocumentRuntimeIntake } from '../reader/document-intake';
import type { DocumentRendering } from '../reader/document-rendering';
import type { ReaderAction, ReadingSessionSnapshot } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const snapshot = (
  documents: ReadingSessionSnapshot['documents'],
  activeDocumentPath: string | null,
): ReadingSessionSnapshot => ({ schemaVersion: 2, revision: 1, activeDocumentPath, documents });

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
      dispatch,
      snapshot: () => snapshot([], null),
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
      dispatch,
      snapshot: () => current,
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
    expect(dispatched.map(({ type }) => type)).toEqual(['registerDocument', 'activateDocument']);
    expect(dispatched[0]).toMatchObject({
      type: 'registerDocument',
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
      dispatch: vi.fn(async () => ({ status: 'no-op' as const, revision: 0 })),
      snapshot: () => snapshot([savedDocument], '/docs/saved.pdf'),
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
});

// Compile-time contract: the workspace provides the runtime consumed by Document Intake,
// without exposing a mutable tab/session model.
const acceptsIntakeRuntime = (_runtime: DocumentRuntimeIntake): void => undefined;
void acceptsIntakeRuntime;
