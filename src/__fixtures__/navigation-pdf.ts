/** Small authored PDF with repeated text, nested bookmarks, metadata, and link actions. */
export function navigationPdf(
  title = 'Navigation fixture',
  nativeRotation = 0,
  includeLinks = true,
): Uint8Array {
  const stream = (text: string) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R >>',
    `<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3${nativeRotation ? ` /Rotate ${nativeRotation}` : ''} >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> ${includeLinks ? '/Annots [17 0 R 18 0 R]' : ''} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 9 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 9 0 R >> >> >>',
    stream('BT /F1 24 Tf 72 720 Td (moon first page) Tj 0 -300 Td (moon lower match) Tj ET'),
    stream('BT /F1 24 Tf 72 720 Td (moon second page) Tj ET'),
    stream('BT /F1 24 Tf 72 720 Td (sun third page) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Outlines /First 11 0 R /Last 14 0 R /Count 5 >>',
    '<< /Title (Chapter) /Parent 10 0 R /Next 12 0 R /First 15 0 R /Last 15 0 R /Count 1 /Dest [4 0 R /XYZ 0 396 0] >>',
    '<< /Title (Website) /Parent 10 0 R /Prev 11 0 R /Next 13 0 R /A << /S /URI /URI (https://example.com/outline) >> >>',
    '<< /Title (Blocked website) /Parent 10 0 R /Prev 12 0 R /Next 14 0 R /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>',
    '<< /Title (Chapter) /Parent 10 0 R /Prev 13 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Nested chapter) /Parent 11 0 R /Dest [5 0 R /Fit] >>',
    `<< /Title (${title}) /Author (Monight) /Subject (Navigation) /Keywords (reader; queries) >>`,
    ...(includeLinks
      ? [
          '<< /Type /Annot /Subtype /Link /P 3 0 R /Rect [72 650 260 685] /Border [0 0 1] /A << /S /URI /URI (https://example.com/page) >> >>',
          '<< /Type /Annot /Subtype /Link /P 3 0 R /Rect [72 590 260 625] /Border [0 0 1] /Dest [4 0 R /XYZ 0 396 0] >>',
        ]
      : []),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 16 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
