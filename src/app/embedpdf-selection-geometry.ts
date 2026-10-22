import { type PdfEngine, type PdfErrorReason, type PdfPageGeometry, Task } from '@embedpdf/models';

const installed = new WeakSet<PdfEngine>();

/**
 * Loose font boxes include the fallback font's full ascent/descent, rather than
 * the selected ink. In the pinned engine that puts a 24pt Helvetica underline
 * 11pt below its baseline. Keep horizontal advances (including spaces), but use
 * each glyph's measured ink vertically, with clearance for the 1pt markup stroke.
 * This feeds selection itself, so immediate markup and active tools agree.
 */
export function inkSelectionGeometry(geometry: PdfPageGeometry): PdfPageGeometry {
  return {
    runs: geometry.runs.map((run) => {
      const ink = run.glyphs.filter(
        (g) => g.flags === 0 && g.tightY !== undefined && (g.tightHeight ?? 0) > 0,
      );
      if (ink.length === 0) return run;
      const clearance = Math.max(2, (run.fontSize ?? 0) * 0.08);
      const glyphs = run.glyphs.map((g) => {
        if (g.flags === 2) return g;
        // Whitespace has no ink: use its nearest visible neighbour's line bounds.
        const measured =
          g.flags === 0 && g.tightY !== undefined && (g.tightHeight ?? 0) > 0
            ? g
            : ink.reduce((a, b) => {
                const distance = (candidate: typeof g) =>
                  Math.hypot(
                    candidate.x + candidate.width / 2 - g.x - g.width / 2,
                    candidate.y + candidate.height / 2 - g.y - g.height / 2,
                  );
                return distance(a) <= distance(b) ? a : b;
              });
        return {
          ...g,
          y: (measured.tightY as number) - clearance,
          height: (measured.tightHeight as number) + 2 * clearance,
        };
      });
      const visible = glyphs.filter((g) => g.flags !== 2);
      const top = Math.min(...visible.map((g) => g.y));
      const bottom = Math.max(...visible.map((g) => g.y + g.height));
      return { ...run, glyphs, rect: { ...run.rect, y: top, height: bottom - top } };
    }),
  };
}

export function installInkSelectionGeometry(engine: PdfEngine): void {
  if (installed.has(engine)) return;
  installed.add(engine);
  const getGeometry = engine.getPageGeometry.bind(engine);
  engine.getPageGeometry = (doc, page) => {
    const task = new Task<PdfPageGeometry, PdfErrorReason>();
    getGeometry(doc, page).wait(
      (geometry) => task.resolve(inkSelectionGeometry(geometry)),
      (error) => task.fail(error),
    );
    return task;
  };
}
