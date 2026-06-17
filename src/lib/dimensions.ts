/**
 * Input for deriving scaled page dimensions from cached base dimensions.
 */
export interface ScaledDimensionsInput {
  baseWidth: number;
  baseHeight: number;
  zoom: number;
  rotation: number;
}

/**
 * Output of scaled page dimensions.
 */
export interface ScaledDimensions {
  width: number;
  height: number;
}

/**
 * Derive scaled page dimensions from base (scale=1, rotation=0) dimensions.
 *
 * - Multiplies by zoom factor
 * - Swaps width/height for 90° and 270° rotations
 * - Normalizes rotation to 0/90/180/270
 */
export function deriveScaledDimensions({
  baseWidth,
  baseHeight,
  zoom,
  rotation,
}: ScaledDimensionsInput): ScaledDimensions {
  // Normalize rotation to 0, 90, 180, 270
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  // Swap width/height for 90° and 270°
  const swapped = normalizedRotation === 90 || normalizedRotation === 270;
  const width = (swapped ? baseHeight : baseWidth) * zoom;
  const height = (swapped ? baseWidth : baseHeight) * zoom;

  return { width, height };
}
