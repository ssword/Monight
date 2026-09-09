import type { UnsavedDocumentChoice, UnsavedDocumentRequest } from '../reader/reader-actions';

export type PasswordRequestReason = 'required' | 'incorrect';

export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dismissible?: boolean;
}

function requireDialog(id: string): HTMLDialogElement {
  const dialog = document.getElementById(id);
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error(`Dialog '${id}' is not available`);
  }
  return dialog;
}

const KEEP_DIALOG_OPEN = Symbol('keep-dialog-open');

function requestDialogValue<T>({
  dialog,
  form,
  cancelButton,
  cancelValue,
  dismissValue = cancelValue,
  submitValue,
  focusTarget,
  afterFocus,
  signal,
}: {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  cancelButton: HTMLButtonElement;
  cancelValue: T;
  dismissValue?: T | typeof KEEP_DIALOG_OPEN;
  submitValue: () => T | typeof KEEP_DIALOG_OPEN;
  focusTarget: HTMLElement;
  afterFocus?: () => void;
  signal?: AbortSignal;
}): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', handleSubmit);
      cancelButton.removeEventListener('click', handleCancel);
      dialog.removeEventListener('cancel', handleDialogCancel);
      signal?.removeEventListener('abort', handleAbort);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const value = submitValue();
      if (value !== KEEP_DIALOG_OPEN) finish(value);
    };
    const handleCancel = () => finish(cancelValue);
    const handleAbort = () => finish(cancelValue);
    const handleDialogCancel = (event: Event) => {
      event.preventDefault();
      if (dismissValue !== KEEP_DIALOG_OPEN) finish(dismissValue);
    };

    form.addEventListener('submit', handleSubmit);
    cancelButton.addEventListener('click', handleCancel);
    dialog.addEventListener('cancel', handleDialogCancel);
    if (signal?.aborted) {
      finish(cancelValue);
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    dialog.showModal();
    focusTarget.focus();
    afterFocus?.();
  });
}

export function requestPdfPassword(
  fileName: string,
  reason: PasswordRequestReason,
  signal?: AbortSignal,
): Promise<string | null> {
  const dialog = requireDialog('password-dialog');
  const form = dialog.querySelector<HTMLFormElement>('form');
  const title = dialog.querySelector<HTMLElement>('[data-password-title]');
  const message = dialog.querySelector<HTMLElement>('[data-password-message]');
  const input = dialog.querySelector<HTMLInputElement>('input[name="password"]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]');

  if (!form || !input || !cancelButton) {
    throw new Error('Password dialog is incomplete');
  }

  if (title) title.textContent = `Unlock ${fileName}`;
  if (message) {
    message.textContent =
      reason === 'incorrect'
        ? 'That password was incorrect. Please try again.'
        : 'This PDF is encrypted. Enter its password to continue.';
  }
  input.value = '';

  return requestDialogValue({
    dialog,
    form,
    cancelButton,
    cancelValue: null,
    submitValue: () => input.value || KEEP_DIALOG_OPEN,
    focusTarget: input,
    ...(signal ? { signal } : {}),
  });
}

export function requestAnnotationNote(initialValue = ''): Promise<string | null> {
  const dialog = requireDialog('annotation-dialog');
  const form = dialog.querySelector<HTMLFormElement>('form');
  const input = dialog.querySelector<HTMLTextAreaElement>('textarea[name="note"]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]');

  if (!form || !input || !cancelButton) {
    throw new Error('Annotation dialog is incomplete');
  }

  input.value = initialValue;

  return requestDialogValue({
    dialog,
    form,
    cancelButton,
    cancelValue: null,
    submitValue: () => input.value.trim(),
    focusTarget: input,
    afterFocus: () => input.select(),
  });
}

export function requestConfirmation({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  dismissible = true,
}: ConfirmationRequest): Promise<boolean> {
  const dialog = requireDialog('confirmation-dialog');
  const form = dialog.querySelector<HTMLFormElement>('form');
  const titleElement = dialog.querySelector<HTMLElement>('[data-confirmation-title]');
  const messageElement = dialog.querySelector<HTMLElement>('[data-confirmation-message]');
  const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-dialog-confirm]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]');

  if (!form || !titleElement || !messageElement || !confirmButton || !cancelButton) {
    throw new Error('Confirmation dialog is incomplete');
  }

  titleElement.textContent = title;
  messageElement.textContent = message;
  confirmButton.textContent = confirmLabel;
  cancelButton.textContent = cancelLabel;

  return requestDialogValue({
    dialog,
    form,
    cancelButton,
    cancelValue: false,
    dismissValue: dismissible ? false : KEEP_DIALOG_OPEN,
    submitValue: () => true,
    focusTarget: confirmButton,
  });
}

export function showToast(message: string, tone: 'info' | 'error' = 'info'): void {
  const region = document.getElementById('toast-region');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  region.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('toast-leaving');
    window.setTimeout(() => toast.remove(), 180);
  }, 3200);
}

let pdfDecisionTail = Promise.resolve();

function requestPdfDecision<T extends string>(
  title: string,
  message: string,
  choices: ReadonlyArray<readonly [T, string]>,
  cancelValue: T,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  const result = pdfDecisionTail.then(() => {
    if (!isCurrent()) return cancelValue;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog pdf-decision-dialog';
    const heading = document.createElement('h2');
    heading.id = 'pdf-decision-title';
    heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    const description = document.createElement('p');
    description.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    dialog.append(heading, description, actions);
    return new Promise<T>((resolve) => {
      const finish = (choice: T) => {
        dialog.close();
        dialog.remove();
        resolve(choice);
      };
      for (const [choice, label] of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = choice === 'save' ? 'dialog-primary' : 'dialog-secondary';
        button.textContent = label;
        button.addEventListener('click', () => finish(choice));
        actions.append(button);
      }
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(cancelValue);
      });
      document.body.append(dialog);
      dialog.showModal();
      actions.querySelector<HTMLButtonElement>('button:last-child')?.focus();
    });
  });
  pdfDecisionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** All destructive recovery choices require an explicit button click. */
export function requestPdfSaveFailure(
  title: string,
  message: string,
  isCurrent?: () => boolean,
): Promise<'save-as' | 'reload' | 'cancel'> {
  return requestPdfDecision<'save-as' | 'reload' | 'cancel'>(
    `Could not save ${title}`,
    `${message} Your unsaved edits are retained.`,
    [
      ['save-as', 'Save As…'],
      ...(/conflict/i.test(message) ? [['reload', 'Discard edits and reload'] as const] : []),
      ['cancel', 'Keep editing'],
    ],
    'cancel',
    isCurrent,
  );
}

export function requestUnsavedDocument({
  title,
  error,
}: UnsavedDocumentRequest): Promise<UnsavedDocumentChoice> {
  return requestPdfDecision<UnsavedDocumentChoice>(
    `Save changes to ${title}?`,
    error
      ? `${String(error)} Your unsaved changes are retained.`
      : 'Your annotation changes will be lost if you discard them.',
    [
      ['save', error ? 'Retry Save' : 'Save'],
      ...(error ? [['save-as', 'Save As…'] as const] : []),
      ['discard', 'Discard'],
      ['cancel', 'Cancel'],
    ],
    'cancel',
  );
}
