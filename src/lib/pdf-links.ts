export type PdfDestination = string | unknown[];

export interface PdfLinkTarget {
  url?: string;
  dest?: PdfDestination;
}

export interface PdfLinkDomAttributes {
  href: string;
  title: string;
  ariaLabel: string;
}

export const INERT_PDF_LINK_HREF = '#';

export function buildPdfLinkDomAttributes(target: PdfLinkTarget): PdfLinkDomAttributes {
  if (target.url) {
    return {
      href: INERT_PDF_LINK_HREF,
      title: 'External PDF link',
      ariaLabel: 'Open external PDF link',
    };
  }

  return {
    href: INERT_PDF_LINK_HREF,
    title: 'Internal PDF link',
    ariaLabel: 'Open internal PDF link',
  };
}
