import type { ReadingSessionStorage } from '../reader/reading-session-store';
import type { SettingsManager } from '../scripts/settings';

export function createReadingSessionStorage(
  settingsManager: SettingsManager,
): ReadingSessionStorage {
  return {
    read: () => settingsManager.readPersistedReadingSession(),
    write: (session) => settingsManager.writePersistedReadingSession(session),
    readLegacy: async () => settingsManager.readLegacyReadingSession(),
    removeLegacy: () => settingsManager.removeLegacyReadingSession(),
  };
}
