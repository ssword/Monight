import { describe, expect, it, vi } from 'vitest';
import { loadReadingSession, type ReadingSessionStorage } from '../reader/reading-session-store';

function legacySession() {
  return {
    version: 1,
    activeFilePath: '/docs/report.pdf',
    tabs: [
      {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        currentPage: 6,
        scrollPosition: 842,
      },
    ],
  };
}

describe('Reading Session store', () => {
  it('migrates, verifies, and only then removes the legacy value', async () => {
    let stored: unknown;
    const events: string[] = [];
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => {
        events.push('read:new');
        return stored;
      }),
      write: vi.fn(async (value) => {
        events.push('write:new');
        stored = value;
      }),
      readLegacy: vi.fn(async () => {
        events.push('read:legacy');
        return legacySession();
      }),
      removeLegacy: vi.fn(async () => {
        events.push('remove:legacy');
      }),
    };

    const session = await loadReadingSession(storage);

    expect(session).toEqual({
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 6, legacyOffset: 842 },
        },
      ],
    });
    expect(events).toEqual(['read:new', 'read:legacy', 'write:new', 'read:new', 'remove:legacy']);
  });

  it('normalizes a schema-one position with only an absolute offset', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 6, scrollPosition: 842 },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    await expect(loadReadingSession(storage)).resolves.toMatchObject({
      documents: [{ readingPosition: { page: 6, legacyOffset: 842 } }],
    });
  });

  it('prefers a fractional location over a stale absolute offset', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 6, location: 0.5, scrollPosition: 842 },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session.documents[0].readingPosition).toEqual({ page: 6, location: 0.5 });
  });

  it('migrates schema-one numeric zoom to a manual Zoom Intent', async () => {
    let stored: unknown = {
      schemaVersion: 1,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 2, location: 0.25 },
          visualState: {
            filterSettings: {
              brightness: 100,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 100,
            },
            zoom: 1.75,
            rotation: 90,
            viewMode: 'continuous',
          },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (value) => {
        stored = value;
      }),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session.schemaVersion).toBe(3);
    expect(session.documents[0].visualState?.zoomIntent).toEqual({
      kind: 'manual',
      scale: 1.75,
    });
    expect(storage.write).toHaveBeenCalledOnce();
  });

  it('never carries sidebar chrome state into the restored Reading Session', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      sidebarVisible: true,
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 2, location: 0.25 },
          sidebarMode: 'thumbnails',
          sidebarWidth: 300,
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session).toEqual({
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 2, location: 0.25 },
        },
      ],
    });
  });

  it('preserves fit Zoom Intent in the current schema', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 2, location: 0.25 },
          visualState: {
            filterSettings: {
              brightness: 100,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 100,
            },
            zoomIntent: { kind: 'fit-width' },
            viewMode: 'single',
          },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session.documents[0].visualState?.zoomIntent).toEqual({ kind: 'fit-width' });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('rejects non-finite manual Zoom Intent scales', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 2, location: 0.25 },
          visualState: {
            filterSettings: {
              brightness: 100,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 100,
            },
            zoomIntent: { kind: 'manual', scale: Number.POSITIVE_INFINITY },
            viewMode: 'single',
          },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session).toEqual({ schemaVersion: 3, activeDocumentPath: null, documents: [] });
  });

  it('retains the legacy value when migration persistence fails', async () => {
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => {
        throw new Error('disk full');
      }),
      readLegacy: vi.fn(async () => legacySession()),
      removeLegacy: vi.fn(),
    };

    await expect(loadReadingSession(storage)).rejects.toThrow('disk full');
    expect(storage.removeLegacy).not.toHaveBeenCalled();
  });

  it('validates converted legacy data before persisting it', async () => {
    const duplicate = legacySession();
    duplicate.tabs.push({ ...duplicate.tabs[0] });
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => undefined),
      write: vi.fn(),
      readLegacy: vi.fn(async () => duplicate),
      removeLegacy: vi.fn(),
    };

    await expect(loadReadingSession(storage)).rejects.toThrow('invalid');
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.removeLegacy).not.toHaveBeenCalled();
  });
  it('migrates a schema-two session by dropping its saved view rotation', async () => {
    const filterSettings = {
      brightness: 100,
      grayscale: 0,
      invert: 1,
      sepia: 0,
      hue: 180,
      extraBrightness: 100,
    };
    let stored: unknown = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 3, location: 0.5 },
          visualState: {
            filterSettings,
            zoomIntent: { kind: 'fit-page' },
            rotation: 270,
            viewMode: 'spread',
          },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (value) => {
        stored = value;
      }),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    const expected = {
      schemaVersion: 3,
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 3, location: 0.5 },
          visualState: { filterSettings, zoomIntent: { kind: 'fit-page' }, viewMode: 'spread' },
        },
      ],
    };
    expect(session).toEqual(expected);
    expect(storage.write).toHaveBeenCalledOnce();
    expect(stored).toEqual(expected);
  });

  it('loads a schema-three session without rewriting it', async () => {
    const stored = {
      schemaVersion: 3,
      activeDocumentPath: null,
      documents: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          readingPosition: { page: 1, location: 0 },
          visualState: {
            filterSettings: {
              brightness: 100,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 100,
            },
            zoomIntent: { kind: 'fit-width' },
            viewMode: 'continuous',
          },
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(),
      readLegacy: vi.fn(async () => undefined),
      removeLegacy: vi.fn(),
    };

    await expect(loadReadingSession(storage)).resolves.toEqual(stored);
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('drops the rotation of a legacy tab session', async () => {
    let stored: unknown;
    const legacy = {
      activeFilePath: '/docs/report.pdf',
      tabs: [
        {
          filePath: '/docs/report.pdf',
          title: 'report.pdf',
          currentPage: 2,
          filterSettings: {
            brightness: 100,
            grayscale: 0,
            invert: 0,
            sepia: 0,
            hue: 0,
            extraBrightness: 100,
          },
          zoom: 1.5,
          rotation: 90,
          viewMode: 'single',
        },
      ],
    };
    const storage: ReadingSessionStorage = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (value) => {
        stored = value;
      }),
      readLegacy: vi.fn(async () => legacy),
      removeLegacy: vi.fn(),
    };

    const session = await loadReadingSession(storage);

    expect(session.schemaVersion).toBe(3);
    expect(session.documents[0].visualState).toEqual({
      filterSettings: legacy.tabs[0].filterSettings,
      zoomIntent: { kind: 'manual', scale: 1.5 },
      viewMode: 'single',
    });
  });
});
