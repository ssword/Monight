import { describe, expect, it } from 'vitest';
import { buildPdfLinkDomAttributes, INERT_PDF_LINK_HREF } from '../lib/pdf-links';

describe('buildPdfLinkDomAttributes', () => {
  it('keeps external annotation URLs out of rendered hrefs', () => {
    const attributes = buildPdfLinkDomAttributes({
      url: 'javascript:alert(document.domain)',
    });

    expect(attributes.href).toBe(INERT_PDF_LINK_HREF);
    expect(attributes.title).not.toContain('javascript:');
    expect(attributes.ariaLabel).not.toContain('javascript:');
  });

  it('uses an inert href for internal destinations', () => {
    const attributes = buildPdfLinkDomAttributes({ dest: [{ num: 1, gen: 0 }] });

    expect(attributes.href).toBe(INERT_PDF_LINK_HREF);
    expect(attributes.title).toBe('Internal PDF link');
    expect(attributes.ariaLabel).toBe('Open internal PDF link');
  });
});
