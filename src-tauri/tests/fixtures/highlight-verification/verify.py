"""Verify #124 evidence; --require-admission also enforces exact preservation.

Requires pypdf. The default verifies the retained failure rather than hiding it.
"""
from pathlib import Path
from hashlib import sha256
import sys
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
COLORS = {
    'yellow': (255, 205, 69), 'green': (126, 217, 87),
    'blue': (108, 180, 245), 'pink': (255, 126, 182),
    'purple': (183, 140, 242),
}


def pages(name):
    return PdfReader(ROOT / name).pages


def highlights(page):
    return [a for ref in page.get('/Annots', [])
            if (a := ref.get_object()).get('/Subtype') == '/Highlight']


def key(page_index, annotation):
    # Preview omits /NM; geometry identifies each distinct line in this fixture.
    return (page_index, tuple(round(float(v), 3) for v in annotation['/QuadPoints']))


def inventory(name):
    return {key(i, a): a for i, p in enumerate(pages(name)) for a in highlights(p)}


def page_contract(name):
    return [(list(p.mediabox), list(p.cropbox), p.rotation,
             sha256(p.get_contents().get_data()).hexdigest()) for p in pages(name)]


def close(left, right):
    return len(left) == len(right) and all(abs(float(a)-float(b)) < 0.001
                                        for a, b in zip(left, right))


def compare(original, returned, exact_appearance=False):
    before, after = inventory(original), inventory(returned)
    assert before.keys() <= after.keys(), (returned, 'missing/moved Highlight')
    for k, a in before.items():
        b = after[k]
        assert close(a['/Rect'], b['/Rect']), (returned, k, 'Rect')
        assert close(a['/QuadPoints'], b['/QuadPoints']), (returned, k, 'QuadPoints')
        if a.get('/NM'):
            assert a['/NM'] == b['/NM'], (returned, k, 'identity')
        if exact_appearance:
            assert close(a['/C'], b['/C']), (returned, k, 'colour changed on comment edit')
            assert a['/AP']['/N'].get_data() == b['/AP']['/N'].get_data(), (returned, k, 'appearance')


def comments(name):
    return {str(a.get('/Contents', '')) for a in inventory(name).values()}


def replies(name):
    return {(str(a['/Contents']), str(a['/IRT'].get_object()['/NM']))
            for p in pages(name) for ref in p.get('/Annots', [])
            if (a := ref.get_object()).get('/Subtype') == '/Text' and a.get('/IRT')}


if __name__ == '__main__':
    for line in (ROOT / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        assert sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    source = page_contract('input.pdf')
    assert [p[2] for p in source] == [0, 90]
    for path in ROOT.glob('*.pdf'):
        assert page_contract(path.name) == source, (path.name, 'page content/boxes/rotation')
    original = 'monight-created-snapshot.pdf'
    for page in pages(original):
        marks = highlights(page)
        assert len(marks) == 5
        assert {tuple(round(float(c)*255) for c in a['/C']) for a in marks} == set(COLORS.values())
    compare(original, 'preview-edited-snapshot.pdf', exact_appearance=True)
    compare(original, 'acrobat-edited-snapshot.pdf', exact_appearance=True)
    for a, b in [
        ('preview-edited-snapshot.pdf', 'preview-monight-final.pdf'),
        ('acrobat-edited-snapshot.pdf', 'acrobat-monight-final.pdf'),
        ('preview-origin-snapshot.pdf', 'preview-origin-monight-final.pdf'),
    ]:
        compare(a, b)
    expected = {f'Preview edited {c} page {p} - 124' for c in COLORS for p in (1, 2)}
    assert comments('preview-edited-snapshot.pdf') == expected
    assert comments('preview-monight-final.pdf') == {f'Monight re-edited Preview {c} page {p} - 124' for c in COLORS for p in (1, 2)}
    assert comments('preview-origin-monight-final.pdf') == {
        f'Monight edited Preview-origin {c} page {p} - 124' for c in COLORS for p in (1, 2)}
    for name in ['preview-origin-snapshot.pdf', 'preview-origin-monight-final.pdf']:
        assert [len(highlights(p)) for p in pages(name)] == [5, 5]
    acrobat_expected = {
        'Monight edited Acrobat-origin page 1 - 124',
        'Monight edited Acrobat-origin page 2 - 124',
        'Monight re-edited Acrobat yellow page 1 - 124',
        'Monight re-edited Acrobat purple page 2 - 124',
    }
    assert comments('acrobat-monight-final.pdf') == acrobat_expected | {''}
    assert [len(highlights(p)) for p in pages('acrobat-edited-snapshot.pdf')] == [6, 6]
    assert [len(highlights(p)) for p in pages('acrobat-monight-final.pdf')] == [6, 6]
    assert replies('acrobat-edited-snapshot.pdf') == replies('acrobat-monight-final.pdf')
    assert len(replies('acrobat-monight-final.pdf')) == 2
    # Pin the discovered discrepancy, not a weakened colour acceptance tolerance.
    before = inventory('preview-edited-snapshot.pdf')
    after = inventory('preview-monight-final.pdf')
    changes = [(tuple(round(float(c)*255) for c in a['/C']),
                tuple(round(float(c)*255) for c in after[k]['/C']))
               for k, a in before.items() if not close(a['/C'], after[k]['/C'])]
    assert sorted(changes) == sorted([
        ((255, 205, 69), (255, 205, 68)),
        ((108, 180, 245), (107, 180, 245)),
        ((183, 140, 242), (183, 139, 242)),
    ] * 2), changes
    print('PASS: eight PDF checksums; page content/boxes/rotation; native identities and geometry; exact comments/replies; 10 Preview-origin and 2 Acrobat-origin Highlights survive Monight saves.')
    print('EXPECTED HISTORICAL FAILURE: comment-only saves regenerate native appearances; six production-colour changes reproduced. Run fixed/verify.py for current Highlight admission.')
    if '--require-admission' in sys.argv:
        compare('preview-edited-snapshot.pdf', 'preview-monight-final.pdf', exact_appearance=True)
