import type { CommandsCapability } from '@embedpdf/snippet';

type EmbedPdfShortcutRegistry = Pick<
  CommandsCapability,
  'getCommandByShortcut' | 'registerCommand' | 'unregisterCommand'
>;

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
