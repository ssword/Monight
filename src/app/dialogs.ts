export type PasswordRequestReason = 'required' | 'incorrect';

function requireDialog(id: string): HTMLDialogElement {
  const dialog = document.getElementById(id);
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error(`Dialog '${id}' is not available`);
  }
  return dialog;
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

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
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
      const password = input.value;
      if (password.length > 0) finish(password);
    };
    const handleCancel = () => finish(null);
    const handleDialogCancel = (event: Event) => {
      event.preventDefault();
      finish(null);
    };

    form.addEventListener('submit', handleSubmit);
    cancelButton.addEventListener('click', handleCancel);
    dialog.addEventListener('cancel', handleDialogCancel);
    dialog.showModal();
    input.focus();
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

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
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
      finish(input.value.trim());
    };
    const handleCancel = () => finish(null);
    const handleDialogCancel = (event: Event) => {
      event.preventDefault();
      finish(null);
    };

    form.addEventListener('submit', handleSubmit);
    cancelButton.addEventListener('click', handleCancel);
    dialog.addEventListener('cancel', handleDialogCancel);
    dialog.showModal();
    input.focus();
    input.select();
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
