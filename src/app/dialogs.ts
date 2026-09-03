export type PasswordRequestReason = 'required' | 'incorrect';

export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
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
  submitValue,
  focusTarget,
  afterFocus,
}: {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  cancelButton: HTMLButtonElement;
  cancelValue: T;
  submitValue: () => T | typeof KEEP_DIALOG_OPEN;
  focusTarget: HTMLElement;
  afterFocus?: () => void;
}): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', handleSubmit);
      cancelButton.removeEventListener('click', handleCancel);
      dialog.removeEventListener('cancel', handleDialogCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const value = submitValue();
      if (value !== KEEP_DIALOG_OPEN) finish(value);
    };
    const handleCancel = () => finish(cancelValue);
    const handleDialogCancel = (event: Event) => {
      event.preventDefault();
      finish(cancelValue);
    };

    form.addEventListener('submit', handleSubmit);
    cancelButton.addEventListener('click', handleCancel);
    dialog.addEventListener('cancel', handleDialogCancel);
    dialog.showModal();
    focusTarget.focus();
    afterFocus?.();
  });
}

export function requestPdfPassword(
  fileName: string,
  reason: PasswordRequestReason,
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

  return requestDialogValue({
    dialog,
    form,
    cancelButton,
    cancelValue: false,
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
