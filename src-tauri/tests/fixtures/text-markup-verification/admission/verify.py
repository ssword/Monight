from pathlib import Path
from pypdf import PdfReader
import hashlib,json
e=Path(__file__).resolve().parent;root=e.parents[4]
for line in (e/'SHA256SUMS').read_text().splitlines():
 digest,name=line.split('  ',1);assert hashlib.sha256((e/name).read_bytes()).hexdigest()==digest,name
def pages(p):
 r=PdfReader(p);return [(list(x.mediabox),list(x.cropbox),x.rotation,hashlib.sha256(x.get_contents().get_data()).hexdigest()) for x in r.pages]
def marks(p):
 return {str(a.get('/Subtype')):a for pg in PdfReader(p).pages for ref in pg.get('/Annots',[]) if (a:=ref.get_object()).get('/Subtype') in ['/Underline','/StrikeOut']}
def signature(a):
 ap=a['/AP']['/N'];return ([float(x) for x in a['/Rect']],[float(x) for x in a['/QuadPoints']],ap.get_data(),list(ap.get('/BBox',[])),list(ap.get('/Matrix',[])))
groups=[(root/'src-tauri/tests/fixtures/text-markup-verification/selection-fonts.pdf',['monight-created-snapshot','acrobat-edited-snapshot','acrobat-deleted-return','acrobat-roundtrip-final','acrobat-monight-deleted','preview-edited-snapshot','preview-deleted-return','preview-roundtrip-final','preview-monight-deleted']), (root/'src-tauri/tests/fixtures/text-markup-verification/acrobat-text-markups.pdf',['acrobat-origin-edited','acrobat-origin-deleted']), (e/'preview-origin-input.pdf',['preview-origin-edited','preview-origin-deleted'])]
for original,names in groups:
 for n in names:assert pages(original)==pages(e/(n+'.pdf')),n
for original,names in [(e/'monight-created-snapshot.pdf',['acrobat-edited-snapshot','acrobat-roundtrip-final','preview-edited-snapshot','preview-roundtrip-final']), (groups[1][0],['acrobat-origin-edited']), (groups[2][0],['preview-origin-edited'])]:
 for n in names:
  for subtype,a in marks(original).items():assert signature(a)==signature(marks(e/(n+'.pdf'))[subtype]),(n,subtype)
for n in ['acrobat-deleted-return','acrobat-monight-deleted','acrobat-origin-deleted','preview-deleted-return','preview-monight-deleted','preview-origin-deleted']:assert not marks(e/(n+'.pdf')),n
print('PASS: all 13 saved snapshots retain decoded page content, MediaBox, CropBox and rotation; 12 markup appearances retain exact program/geometry; all 6 deletion snapshots have no Underline/StrikeOut.')
