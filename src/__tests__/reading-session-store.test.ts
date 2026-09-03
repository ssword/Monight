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
      schemaVersion: 2,
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
      schemaVersion: 2,
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
      schemaVersion: 2,
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

  it('migrates schema-one numeric zoom to schema-two manual Zoom Intent', async () => {
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

    expect(session.schemaVersion).toBe(2);
    expect(session.documents[0].visualState?.zoomIntent).toEqual({
      kind: 'manual',
      scale: 1.75,
    });
    expect(storage.write).toHaveBeenCalledOnce();
  });

  it('preserves fit Zoom Intent in schema two', async () => {
    const stored = {
      schemaVersion: 2,
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
            rotation: 0,
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
});
