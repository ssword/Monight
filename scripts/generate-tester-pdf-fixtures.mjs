import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputDirectory = resolve('src-tauri/tests/fixtures/tester-kit');

function pdf(objects, info) {
  const offsets = [];
  let contents = '%PDF-1.4\n% Monight tester fixture; generated file, do not edit.\n';
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(contents, 'latin1'));
    contents += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(contents, 'latin1');
  contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  contents += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  contents += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R`;
  contents += info ? ` /Info ${info} 0 R` : '';
  contents += ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return contents;
}

function stream(contents) {
  return `<< /Length ${Buffer.byteLength(contents, 'latin1')} >>\nstream\n${contents}\nendstream`;
}

function unicodeMap(name, mappings) {
  const entries = mappings
    .map(([source, destination]) => `<${source}> <${destination}>`)
    .join('\n');
  return stream(
    `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /${name} def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${mappings.length} beginbfchar\n${entries}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
  );
}

function validDocumentA() {
  const pageOne =
    'BT /F1 24 Tf 72 720 Td (Monight valid Document A) Tj 0 -42 Td /F1 14 Tf (Search marker: moonlight alpha) Tj 0 -52 Td (Internal page link) Tj 0 -36 Td (HTTPS HTTP mailto JavaScript file custom links) Tj ET';
  const pageTwo =
    'BT /F1 24 Tf 72 720 Td (Second page) Tj 0 -42 Td /F1 14 Tf (Search marker: moonlight beta) Tj ET';
  return pdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /Outlines 15 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> /Annots [8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R 14 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
      stream(pageOne),
      stream(pageTwo),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Annot /Subtype /Link /Rect [72 620 260 650] /Border [0 0 1] /Dest [4 0 R /Fit] >>',
      '<< /Type /Annot /Subtype /Link /Rect [72 570 140 595] /Border [0 0 1] /A << /S /URI /URI (https://example.com/monight) >> >>',
      '<< /Type /Annot /Subtype /Link /Rect [145 570 210 595] /Border [0 0 1] /A << /S /URI /URI (http://example.com/monight) >> >>',
      '<< /Type /Annot /Subtype /Link /Rect [215 570 280 595] /Border [0 0 1] /A << /S /URI /URI (mailto:fixture@example.com) >> >>',
      '<< /Type /Annot /Subtype /Link /Rect [285 570 350 595] /Border [0 0 1] /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>',
      '<< /Type /Annot /Subtype /Link /Rect [355 570 420 595] /Border [0 0 1] /A << /S /URI /URI (file:///tmp/monight-fixture) >> >>',
      '<< /Type /Annot /Subtype /Link /Rect [425 570 490 595] /Border [0 0 1] /A << /S /URI /URI (custom:monight-fixture) >> >>',
      '<< /Type /Outlines /First 16 0 R /Last 16 0 R /Count 1 >>',
      '<< /Title (Second page) /Parent 15 0 R /Dest [4 0 R /Fit] >>',
      '<< /Title (Monight valid Document A) /Author (Monight tester kit) >>',
    ],
    17,
  );
}

function validDocumentB() {
  const visibleContent =
    'BT /F1 22 Tf 72 500 Td (Monight valid Document B) Tj 0 -40 Td /F1 14 Tf (Distinct intake, ordering, and large-save fixture) Tj ET';
  const content = `${visibleContent}\n% ${'0'.repeat(4_000_000)}`;
  return pdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      stream(content),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
      '<< /Title (Monight valid Document B) /Author (Monight tester kit) >>',
    ],
    6,
  );
}

function fallbackFontDocument() {
  const content = [
    'BT /FC 24 Tf 72 700 Td <4F60597D> Tj ET',
    '/Span << /ActualText <FEFF06440627> >> BDC BT /FA 32 Tf 72 620 Td <FEFB> Tj ET EMC',
    '/Span << /ActualText <FEFF05E905DC05D505DD> >> BDC BT /FH 32 Tf 72 555 Td <05DD05D505DC05E9> Tj ET EMC',
  ].join('\n');
  return pdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /FC 7 0 R /FA 9 0 R /FH 11 0 R >> >> /Annots [13 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /FC 7 0 R /FA 9 0 R /FH 11 0 R >> >> >>',
      stream(content),
      stream(content),
      '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [8 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>',
      '<< /Type /Font /Subtype /Type0 /BaseFont /NotoNaskhArabic /Encoding /Identity-H /DescendantFonts [10 0 R] /ToUnicode 15 0 R >>',
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoNaskhArabic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 17 0 R >>',
      '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansHebrew /Encoding /Identity-H /DescendantFonts [12 0 R] /ToUnicode 16 0 R >>',
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansHebrew /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 18 0 R >>',
      '<< /Type /Annot /Subtype /Link /Rect [400 680 520 730] /Border [0 0 1] /A << /S /GoTo /D [4 0 R /XYZ 0 600 1] >> >>',
      '<< /Title (Fallback font Document: CJK, Arabic, Hebrew) /Author (Monight tester kit) >>',
      unicodeMap('MonightArabic', [['FEFB', 'FEFB']]),
      unicodeMap('MonightHebrew', [
        ['05DD', '05DD'],
        ['05D5', '05D5'],
        ['05DC', '05DC'],
        ['05E9', '05E9'],
      ]),
      '<< /Type /FontDescriptor /FontName /NotoNaskhArabic /Flags 4 /FontBBox [-1000 -1000 2000 2000] /ItalicAngle 0 /Ascent 1069 /Descent -634 /CapHeight 714 /StemV 80 >>',
      '<< /Type /FontDescriptor /FontName /NotoSansHebrew /Flags 4 /FontBBox [-1000 -1000 2000 2000] /ItalicAngle 0 /Ascent 1069 /Descent -293 /CapHeight 714 /StemV 80 >>',
    ],
    14,
  );
}

mkdirSync(outputDirectory, { recursive: true });
for (const [name, contents] of [
  ['valid-document-a.pdf', validDocumentA()],
  ['valid-document-b.pdf', validDocumentB()],
  ['fallback-font.pdf', fallbackFontDocument()],
]) {
  writeFileSync(join(outputDirectory, name), contents, 'latin1');
  console.log(`Wrote ${name}`);
}
