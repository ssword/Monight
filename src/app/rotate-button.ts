// The toolbar Rotate button. Like Preview's, a click rotates left and an
// Option/Alt-click rotates right, through the same Tools ▸ Rotate commands as
// the menu and the ⌘L/⌘R shortcuts (reader-commands.ts): the selected
// thumbnails, or the current page when none are selected.
//
// The button exists only once Page Rotation is verified (PAGE_ROTATION_VERIFIED,
// ADR 0003); until then its toolbar slot stays empty and hidden.

import { isMacPlatform } from '../lib/platform';
import { PAGE_ROTATION_VERIFIED } from '../lib/verification-gates';
import { hydrateChromeIcons } from './chrome-icons';
import type { ActiveMarkupState } from './document-workspace';

export interface RotateButtonOptions {
  /** The toolbar capsule the button is placed in. */
  readonly slot: HTMLElement;
  /** Defaults to PAGE_ROTATION_VERIFIED. */
  readonly verified?: boolean;
  readonly isMac?: boolean;
  /** The active Document's editing state; protected Documents carry their reason. */
  readonly activeMarkup: () => ActiveMarkupState | null;
  /** Runs a reader command by id (the native menu's Tools ▸ Rotate items). */
  readonly runCommand: (id: string) => Promise<boolean>;
}

export interface RotateButton {
  /** Re-reads the active Document; call on Reading Session and rendering changes. */
  refresh(): void;
  destroy(): void;
}

const ROTATE_LEFT = 'tools.rotate.left';
const ROTATE_RIGHT = 'tools.rotate.right';

/** Mounts the Rotate button; null (and nothing shown) while Page Rotation is unverified. */
export function createRotateButton({
  slot,
  verified = PAGE_ROTATION_VERIFIED,
  isMac = isMacPlatform(),
  activeMarkup,
  runCommand,
}: RotateButtonOptions): RotateButton | null {
  if (!verified) {
    slot.replaceChildren();
    slot.hidden = true;
    return null;
  }

  const button = document.createElement('button');
  button.id = 'rotate-pages';
  button.type = 'button';
  button.className = 'toolbar-btn';
  button.setAttribute('aria-label', 'Rotate Left');
  const icon = document.createElement('span');
  icon.className = 'toolbar-icon';
  icon.dataset.icon = 'rotate-left';
  button.append(icon);
  slot.replaceChildren(button);
  slot.hidden = false;
  hydrateChromeIcons(slot);

  const label = `Rotate Left (${isMac ? 'Option' : 'Alt'}-click to Rotate Right)`;
  const render = () => {
    const markup = activeMarkup();
    const reason = markup?.readOnlyReason ?? null;
    button.disabled = markup === null || reason !== null;
    button.title = reason ?? label;
  };

  const onClick = (event: MouseEvent) => {
    render();
    if (button.disabled) return;
    void runCommand(event.altKey ? ROTATE_RIGHT : ROTATE_LEFT);
  };
  button.addEventListener('click', onClick);
  render();

  return {
    refresh: render,
    destroy() {
      button.removeEventListener('click', onClick);
      slot.replaceChildren();
      slot.hidden = true;
    },
  };
}
