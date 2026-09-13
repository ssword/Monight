#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.65.0"]
# ///
"""Build the local Latin, Arabic, and Hebrew PDFium fallback font."""

from pathlib import Path
from tempfile import TemporaryDirectory

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem


ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "public/embedpdf/fonts"
OUTPUT = FONTS / "MonightMultiscriptFallback-Regular.ttf"
FONT_NAMES = {
    1: "Monight Multiscript Fallback",
    2: "Regular",
    3: "Monight Multiscript Fallback Regular",
    4: "Monight Multiscript Fallback Regular",
    6: "MonightMultiscriptFallback-Regular",
}


class DeterministicMerger(Merger):
    def _openFonts(self, fontfiles: list[Path]) -> list[TTFont]:
        fonts = [TTFont(path, recalcTimestamp=False) for path in fontfiles]
        for font, path in zip(fonts, fontfiles, strict=True):
            font._merger__fontfile = path
            font._merger__name = font["name"].getDebugName(4)
        return fonts


def rename_font(font: TTFont) -> None:
    for record in font["name"].names:
        value = FONT_NAMES.get(record.nameID)
        if value is not None:
            record.string = value.encode(record.getEncoding())


def main() -> None:
    source_paths = [
        FONTS / "NotoSans-Regular.ttf",
        FONTS / "NotoNaskhArabic-Regular.ttf",
        FONTS / "NotoSansHebrew-Regular.ttf",
    ]
    timestamps = []
    for source_path in source_paths:
        source = TTFont(source_path, recalcTimestamp=False)
        timestamps.append((source["head"].created, source["head"].modified))
        source.close()

    with TemporaryDirectory() as temporary_directory:
        scaled_latin_path = Path(temporary_directory) / "NotoSans-Regular-2048.ttf"
        latin = TTFont(source_paths[0], recalcTimestamp=False)
        scale_upem(latin, 2048)
        latin.save(scaled_latin_path, reorderTables=False)

        merged = DeterministicMerger().merge(
            [
                scaled_latin_path,
                *source_paths[1:],
            ]
        )
        merged.recalcTimestamp = False
        merged["head"].created = max(created for created, _ in timestamps)
        merged["head"].modified = max(modified for _, modified in timestamps)
        rename_font(merged)
        merged.save(OUTPUT, reorderTables=False)

    print(f"Wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
