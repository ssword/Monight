// App-wide reader chrome preferences: shared by every Document and kept
// outside the Reading Session and Visual State (see CONTEXT.md).
//
// Adding a preference: extend ChromePreferences, DEFAULT_CHROME_PREFERENCES and
// PREFERENCE_PARSERS. Stored values are parsed field by field, so older files
// without the new field keep every other preference.

/** Persisted sidebar modes; Hide is `sidebarVisible: false`, not a mode. */
export const SIDEBAR_MODES = ['thumbnails'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export const SIDEBAR_WIDTH_BOUNDS = { min: 140, max: 480 } as const;

export interface ChromePreferences {
  readonly sidebarVisible: boolean;
  readonly sidebarMode: SidebarMode;
  readonly sidebarWidth: number;
}

export interface PersistedChromePreferences extends ChromePreferences {
  readonly schemaVersion: 1;
}

export interface ChromePreferencesStorage {
  read(): Promise<unknown>;
  write(preferences: PersistedChromePreferences): Promise<void>;
}

export interface ChromePreferencesAuthority {
  snapshot(): ChromePreferences;
  update(changes: Partial<ChromePreferences>): void;
  observe(listener: (preferences: ChromePreferences) => void): () => void;
  flush(): Promise<void>;
}

interface LoadChromePreferencesOptions {
  readonly debounceMs?: number;
  readonly onPersistenceError?: (error: unknown) => void;
}

export const DEFAULT_CHROME_PREFERENCES: ChromePreferences = Object.freeze({
  sidebarVisible: false,
  sidebarMode: 'thumbnails',
  sidebarWidth: 220,
});

const clampSidebarWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR_WIDTH_BOUNDS.max, Math.max(SIDEBAR_WIDTH_BOUNDS.min, width)));

type PreferenceParsers = {
  readonly [K in keyof ChromePreferences]: (value: unknown) => ChromePreferences[K] | undefined;
};

const PREFERENCE_PARSERS: PreferenceParsers = {
  sidebarVisible: (value) => (typeof value === 'boolean' ? value : undefined),
  sidebarMode: (value) => SIDEBAR_MODES.find((mode) => mode === value) as SidebarMode | undefined,
  sidebarWidth: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? clampSidebarWidth(value) : undefined,
};

const PREFERENCE_KEYS = Object.keys(PREFERENCE_PARSERS) as (keyof ChromePreferences)[];

function parseChromePreferences(
  value: unknown,
  base: ChromePreferences = DEFAULT_CHROME_PREFERENCES,
): ChromePreferences {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const parsed: Record<string, unknown> = { ...base };
  for (const key of PREFERENCE_KEYS) {
    const field = PREFERENCE_PARSERS[key](record[key]);
    if (field !== undefined) parsed[key] = field;
  }
  return parsed as unknown as ChromePreferences;
}

const samePreferences = (left: ChromePreferences, right: ChromePreferences): boolean =>
  PREFERENCE_KEYS.every((key) => left[key] === right[key]);

export async function loadChromePreferences(
  storage: ChromePreferencesStorage,
  { debounceMs = 250, onPersistenceError }: LoadChromePreferencesOptions = {},
): Promise<ChromePreferencesAuthority> {
  let current: ChromePreferences = DEFAULT_CHROME_PREFERENCES;
  try {
    current = parseChromePreferences(await storage.read());
  } catch (error) {
    onPersistenceError?.(error);
  }
  const listeners = new Set<(preferences: ChromePreferences) => void>();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;

  const write = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await writing?.catch(() => undefined);
    if (!dirty) return;
    dirty = false;
    const persisted: PersistedChromePreferences = { schemaVersion: 1, ...current };
    writing = storage.write(persisted);
    try {
      await writing;
    } catch (error) {
      dirty = true;
      onPersistenceError?.(error);
      throw error;
    } finally {
      writing = null;
    }
  };

  return {
    snapshot: () => ({ ...current }),
    update(changes) {
      const next = parseChromePreferences(changes, current);
      if (samePreferences(next, current)) return;
      current = next;
      dirty = true;
      for (const listener of listeners) listener({ ...current });
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void write().catch(() => undefined);
      }, debounceMs);
    },
    observe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: write,
  };
}
