/** Decode file bytes without replacement or BOM removal.
 * The caller owns syntax/BOM policy; malformed encoding is an operational error.
 * `source` identifies the input in that error without including its contents.
 */
export function decodeUtf8(bytes: Uint8Array, source: string): string {
  try {
    // https://nodejs.org/api/util.html#new-textdecoderencoding-options
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new TypeError(`${source}: input is not valid UTF-8`);
    throw error;
  }
}
