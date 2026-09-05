import type { PersistedReadingSession } from '../reader/reader-actions';
import type { ReadingSessionStorage } from '../reader/reading-session-store';

interface ReadingSessionPersistence {
  readPersistedReadingSession(): Promise<unknown>;
  writePersistedReadingSession(session: PersistedReadingSession): Promise<void>;
  readLegacyReadingSession(): Promise<unknown>;
  removeLegacyReadingSession(): Promise<void>;
}

export function createReadingSessionStorage(
  settingsManager: ReadingSessionPersistence,
): ReadingSessionStorage {
  return {
    read: () => settingsManager.readPersistedReadingSession(),
    write: (session) => settingsManager.writePersistedReadingSession(session),
    readLegacy: async () => settingsManager.readLegacyReadingSession(),
    removeLegacy: () => settingsManager.removeLegacyReadingSession(),
  };
}
