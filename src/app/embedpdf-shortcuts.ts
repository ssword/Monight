import type { CommandsCapability } from '@embedpdf/snippet';

type EmbedPdfShortcutRegistry = Pick<
  CommandsCapability,
  'getCommandByShortcut' | 'registerCommand' | 'unregisterCommand'
>;

/**
 * EmbedPDF commands whose shortcuts Monight removes because the reader's own
 * commands (and Reader Actions) own them: zoom, rotation, scrolling, document
 * commands, search, and Undo/Redo (Edit ▸ Undo/Redo dispatch undoEdit/redoEdit).
 */
export function monightOwnsEmbedPdfCommand(commandId: string): boolean {
  return /^(zoom:|rotate:|scroll:|document:|history:|panel:toggle-search$)/.test(commandId);
}

export function removeEmbedPdfCommandShortcuts(
  registry: EmbedPdfShortcutRegistry,
  commandId: string,
  shortcuts: readonly string[],
): void {
  const command = shortcuts
    .map((shortcut) => registry.getCommandByShortcut(shortcut))
    .find((candidate) => candidate?.id === commandId);
  if (!command) return;

  registry.unregisterCommand(commandId);
  registry.registerCommand({ ...command, shortcuts: undefined });
}
