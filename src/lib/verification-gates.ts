// Verification gates (ADR 0003): features that stay absent from every control,
// shortcut and menu until their round-trip verification passes. Lives in lib so
// both the reader chrome (src/app) and the Settings defaults (src/scripts) read
// the same gate.

/**
 * Page Rotation controls stay hidden until rotated pages, including their
 * existing Annotations, pass round-trip verification (ADR 0003).
 */
export const PAGE_ROTATION_VERIFIED = false;
