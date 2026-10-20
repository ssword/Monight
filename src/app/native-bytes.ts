/**
 * Copies a Tauri binary command response into bytes owned by the caller. Packaged
 * IPC may deliver an ArrayBuffer from another realm, a typed view, or the numeric
 * array fallback, so none of them can be assumed.
 */
export function bytesFromNativeResponse(response: unknown, invalidMessage: string): Uint8Array {
  if (Object.prototype.toString.call(response) === '[object ArrayBuffer]') {
    return new Uint8Array(response as ArrayBuffer).slice();
  }
  if (ArrayBuffer.isView(response)) {
    return new Uint8Array(response.buffer, response.byteOffset, response.byteLength).slice();
  }
  if (
    Array.isArray(response) &&
    response.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  ) {
    return Uint8Array.from(response);
  }
  throw new Error(invalidMessage);
}
