/**
 * Whether an event target or focused element takes typing (a text field,
 * select or contenteditable), whose own keys and Undo/Redo come first.
 */
export function isEditableTarget(target: EventTarget | Element | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tagName = element.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable === true
  );
}
