export interface SafeOutputScaleInput {
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  maxArea: number;
  maxDpr: number;
}

export interface OutputScale {
  sx: number;
  sy: number;
}

export const DEFAULT_MAX_OUTPUT_SCALE_DPR = 2;
export const DEFAULT_MAX_CANVAS_AREA = 16_777_216;

export function computeSafeOutputScale({
  devicePixelRatio,
  viewportWidth,
  viewportHeight,
  maxArea,
  maxDpr,
}: SafeOutputScaleInput): OutputScale {
  const effectiveDpr = Math.min(devicePixelRatio, maxDpr);
  const scaledArea = viewportWidth * effectiveDpr * viewportHeight * effectiveDpr;
  const scale =
    scaledArea > maxArea ? effectiveDpr * Math.sqrt(maxArea / scaledArea) : effectiveDpr;

  return { sx: scale, sy: scale };
}
