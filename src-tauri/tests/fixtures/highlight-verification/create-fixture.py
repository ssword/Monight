from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pathlib import Path
out=Path(__file__).parent
c=canvas.Canvas(str(out/'unrotated.pdf'),pagesize=(612,792),invariant=1)
for page in (1,2):
 c.setFont('Helvetica',18);c.drawString(60,744,f'Highlight round trips 124 - page {page}')
 for i,(font,size,text) in enumerate([
  ('Helvetica',24,'Yellow sun third page'),
  ('Times-Italic',24,'Green gypsy descenders'),
  ('Courier-Bold',24,'Blue CAPITALS mixed'),
  ('Helvetica',24,'Pink moon lower line'),
  ('Times-Roman',24,'Purple five colours'),
 ]):
  c.setFont(font,size);c.drawString(60,660-i*85,text)
 c.showPage()
c.save()
r=PdfReader(out/'unrotated.pdf'); w=PdfWriter();w.append(r);w.pages[1].rotate(90)
w.write(out/'input.pdf')
