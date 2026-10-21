// When the tab bar shows: the one rule behind the tab bar itself (ui.ts) and
// View ▸ Show/Hide Tab Bar (reader-commands.ts).

/**
 * Shown only while two or more Documents are open, like macOS tabs;
 * `keptShown` (View ▸ Show Tab Bar, for this app run) keeps it for one Document.
 */
export function tabBarShown(documentCount: number, keptShown = false): boolean {
  return documentCount >= 2 || (keptShown && documentCount > 0);
}
