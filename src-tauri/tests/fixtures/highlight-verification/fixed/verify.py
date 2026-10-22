"""Read-only verification of the native #124/#127 fixed-candidate evidence.

Requires pypdf. Run directly; inputs from the earlier matrix stay in ../.
"""
from hashlib import sha256
from pathlib import Path
import importlib.util
import sys

from pypdf import PdfReader

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('original', ROOT.parent / 'verify.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)


def inventory(path):
    return {original.key(i, a): a for i, p in enumerate(PdfReader(path).pages)
            for a in original.highlights(p)}


def equivalent(a, b):
    """Compare PDF values after resolving references and stream compression."""
    a, b = a.get_object() if hasattr(a, 'get_object') else a, b.get_object() if hasattr(b, 'get_object') else b
    if hasattr(a, 'get_data'):
        assert hasattr(b, 'get_data') and a.get_data() == b.get_data(), 'decoded stream changed'
    if isinstance(a, dict):
        ignored = {'/Length', '/Filter', '/DecodeParms'} if hasattr(a, 'get_data') else set()
        keys = set(a) - ignored
        assert keys == set(b) - ignored, 'PDF dictionary keys changed'
        for k in keys:
            equivalent(a[k], b[k])
    elif isinstance(a, list):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equivalent(x, y)
    elif isinstance(a, (int, float)):
        assert abs(float(a) - float(b)) < 0.001, (a, b)
    else:
        assert a == b, (a, b)


def page_contract(path):
    return [(list(p.mediabox), list(p.cropbox), p.rotation,
             sha256(p.get_contents().get_data()).hexdigest()) for p in PdfReader(path).pages]


def replies(path):
    return {(str(a.get('/Contents', '')), str(a['/IRT'].get_object()['/NM']))
            for p in PdfReader(path).pages for ref in p.get('/Annots', [])
            if (a := ref.get_object()).get('/Subtype') == '/Text' and a.get('/IRT')}


def compare(before_path, after_path):
    before, after = inventory(before_path), inventory(after_path)
    assert before.keys() == after.keys(), 'missing, added or moved Highlight'
    assert page_contract(before_path) == page_contract(after_path)
    assert replies(before_path) == replies(after_path)
    for k, a in before.items():
        b = after[k]
        for field in ['/Rect', '/QuadPoints']:
            assert original.close(a[field], b[field]), (after_path.name, field)
        if a.get('/NM'):
            assert a['/NM'] == b['/NM'], 'native identity changed'
        assert len(a['/C']) == len(b['/C']) == 3
        assert all(abs(float(x) - float(y)) <= 1 / 255 + 1e-6
                   for x, y in zip(a['/C'], b['/C'])), 'colour exceeds #127 tolerance'
        equivalent(a['/AP']['/N'], b['/AP']['/N'])
    return after


if __name__ == '__main__':
    for line in (ROOT / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        assert sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    for source, saved, label, count in [
        ('preview-edited-snapshot.pdf', 'preview-return-monight.pdf', 'Preview', 10),
        ('preview-origin-snapshot.pdf', 'preview-origin-monight.pdf', 'Preview-origin', 10),
        ('acrobat-edited-snapshot.pdf', 'acrobat-return-monight.pdf', 'Acrobat', 12),
    ]:
        after = compare(ROOT.parent / source, ROOT / saved)
        assert len(after) == count
        for page in (0, 1):
            # Native creation order differs, especially on the rotated page.
            ordered = sorted((a for (i, _), a in after.items() if i == page),
                             key=lambda a: max(map(float, a['/QuadPoints'][1::2])), reverse=True)
            names = (['heading'] if count == 12 else []) + list(original.COLORS)
            assert [str(a.get('/Contents', '')) for a in ordered] == [
                f'Fixed Monight {label} {c} page {page + 1} - 124' for c in names], saved
        print(f'PASS: {saved}: {count} exact native appearances/resources, geometry, comments and replies')
    assert len(replies(ROOT / 'acrobat-return-monight.pdf')) == 2

    fresh = compare(ROOT / 'fresh-preview-input.pdf', ROOT / 'fresh-roundtrip-final.pdf')
    expected = {'Fixed Monight fresh yellow page 1 - 124', 'Fixed Monight fresh purple page 2 - 124', ''}
    assert {str(a.get('/Contents', '')) for a in fresh.values()} == expected
    assert [p.rotation for p in PdfReader(ROOT / 'fresh-roundtrip-final.pdf').pages] == [0, 90]
    for page in (0, 1):
        marks = [a for (i, _), a in fresh.items() if i == page]
        assert len(marks) == 5
        ordered = sorted(marks, key=lambda a: max(map(float, a['/QuadPoints'][1::2])), reverse=True)
        assert [str(a.get('/Contents', '')) for a in ordered] == [
            f'Fixed Monight fresh {colour} page {page + 1} - 124'
            if (page, colour) in {(0, 'yellow'), (1, 'purple')} else ''
            for colour in original.COLORS]
        for colour in original.COLORS.values():
            assert sum(all(abs(float(c) - expected / 255) <= 1 / 255 + 1e-6
                           for c, expected in zip(a['/C'], colour)) for a in marks) == 1
    assert page_contract(ROOT / 'fresh-roundtrip-final.pdf') == page_contract(ROOT.parent / 'input.pdf')

    before = inventory(ROOT / 'preview-origin-monight.pdf')
    visual = inventory(ROOT / 'visual-colour-monight.pdf')
    assert before.keys() == visual.keys()
    changed = [k for k in before if before[k]['/AP']['/N'].get_data() != visual[k]['/AP']['/N'].get_data()]
    assert len(changed) == 1, 'the genuine colour edit must regenerate exactly its own appearance'
    mark = visual[changed[0]]
    assert tuple(round(float(c) * 255) for c in mark['/C']) == original.COLORS['blue']
    assert mark['/AP']['/N']['/Resources']['/ExtGState']['/GS']['/BM'] == '/Multiply'
    assert page_contract(ROOT / 'visual-colour-monight.pdf') == page_contract(ROOT / 'preview-origin-monight.pdf')
    for k, a in before.items():
        b = visual[k]
        assert original.close(a['/Rect'], b['/Rect'])
        assert original.close(a['/QuadPoints'], b['/QuadPoints'])
        assert a.get('/Contents') == b.get('/Contents')
        if k not in changed:
            equivalent(a['/AP']['/N'], b['/AP']['/N'])
    print('PASS: fresh five-colour/rotation return; genuine colour edit regenerates Multiply appearance; six PDF checksums')
