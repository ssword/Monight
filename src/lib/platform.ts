/** Whether this window runs on macOS (⌘ shortcuts, Option-click, overlay title bar). */
export function isMacPlatform(): boolean {
  return (globalThis.navigator?.platform ?? '').toUpperCase().includes('MAC');
}
