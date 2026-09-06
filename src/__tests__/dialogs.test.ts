// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { requestConfirmation, requestPdfPassword } from '../app/dialogs';

const mountConfirmationDialog = (): void => {
  document.body.innerHTML = `
    <dialog id="confirmation-dialog">
      <form method="dialog">
        <h2 data-confirmation-title></h2>
        <p data-confirmation-message></p>
        <button type="button" data-dialog-cancel>Cancel</button>
        <button type="submit" data-dialog-confirm>Confirm</button>
      </form>
    </dialog>
  `;
};

const mountPasswordDialog = (): void => {
  document.body.innerHTML = `
    <dialog id="password-dialog">
      <form method="dialog">
        <h2 data-password-title></h2>
        <p data-password-message></p>
        <input name="password" />
        <button type="button" data-dialog-cancel>Cancel</button>
        <button type="submit">Unlock</button>
      </form>
    </dialog>
  `;
};

describe('requestConfirmation', () => {
  beforeEach(mountConfirmationDialog);

  it('shows the requested confirmation and resolves true when submitted', async () => {
    const result = requestConfirmation({
      title: 'Replace shortcut?',
      message: 'This shortcut is already in use.',
      confirmLabel: 'Replace',
    });

    const dialog = document.getElementById('confirmation-dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-confirmation-title]')?.textContent).toBe(
      'Replace shortcut?',
    );
    expect(dialog.querySelector('[data-confirmation-message]')?.textContent).toBe(
      'This shortcut is already in use.',
    );
    expect(dialog.querySelector('[data-dialog-confirm]')?.textContent).toBe('Replace');

    dialog
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await expect(result).resolves.toBe(true);
    expect(dialog.open).toBe(false);
  });

  it('resolves false when cancelled', async () => {
    const result = requestConfirmation({
      title: 'Clear history?',
      message: 'This cannot be undone.',
    });

    document.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.click();

    await expect(result).resolves.toBe(false);
  });

  it('requires an explicit button choice when dismissal is disabled', async () => {
    const result = requestConfirmation({
      title: 'Changes not saved',
      message: 'Choose how to continue.',
      cancelLabel: 'Quit without saving',
      dismissible: false,
    });
    const dialog = document.getElementById('confirmation-dialog') as HTMLDialogElement;

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await Promise.resolve();

    expect(dialog.open).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.click();
    await expect(result).resolves.toBe(false);
  });
});

describe('requestPdfPassword', () => {
  it('closes and resolves cancellation when restoration shutdown aborts the request', async () => {
    mountPasswordDialog();
    const cancellation = new AbortController();

    const result = requestPdfPassword('protected.pdf', 'required', cancellation.signal);
    const dialog = document.getElementById('password-dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    cancellation.abort();

    await expect(result).resolves.toBeNull();
    expect(dialog.open).toBe(false);
  });
});
