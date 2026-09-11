// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestConfirmation,
  requestPdfPassword,
  requestPdfSaveFailure,
  requestRecoveryDraft,
  requestUnsavedDocument,
} from '../app/dialogs';

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

describe('PDF close decisions', () => {
  it('offers Save/Discard/Cancel, serializes save failures, and treats Escape as Cancel', async () => {
    document.body.replaceChildren();
    const closing = requestUnsavedDocument({ filePath: '/first.pdf', title: 'first.pdf' });
    const saveFailure = requestPdfSaveFailure('second.pdf', 'Disk full');
    await vi.waitFor(() => expect(document.querySelectorAll('dialog[open]')).toHaveLength(1));
    expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Save',
      'Discard',
      'Cancel',
    ]);
    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await closing).toBe('cancel');
    await vi.waitFor(() =>
      expect(document.querySelector('h2')?.textContent).toContain('second.pdf'),
    );
    document.querySelector<HTMLButtonElement>('button:last-child')?.click();
    expect(await saveFailure).toBe('cancel');
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
  });
});

describe('Recovery Draft decisions', () => {
  it('offers recovery without implying that it saves the original PDF', async () => {
    document.body.replaceChildren();
    const decision = requestRecoveryDraft({
      documentPath: '/docs/report.pdf',
      title: 'report.pdf',
      editedRevision: 3,
    });

    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
    expect(document.querySelector('h2')?.textContent).toContain('report.pdf');
    expect(document.querySelector('p')?.textContent).toContain('will not save');
    document.querySelector<HTMLButtonElement>('.dialog-primary')?.click();

    await expect(decision).resolves.toBe('recover');
  });

  it('keeps the draft when the recovery prompt is dismissed', async () => {
    document.body.replaceChildren();
    const decision = requestRecoveryDraft({
      documentPath: '/docs/report.pdf',
      title: 'report.pdf',
      editedRevision: 3,
    });
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());

    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));

    await expect(decision).resolves.toBe('cancel');
  });
});
