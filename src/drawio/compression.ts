/**
 * draw.io's documented page-content compression scheme (PRD section 7):
 *
 *   compress:   xml -> encodeURIComponent -> pako.deflateRaw -> base64
 *   decompress: base64 -> raw-inflate -> decodeURIComponent -> xml
 */
import * as pako from "pako";

/**
 * Compresses mxGraphModel XML into draw.io's base64 raw-deflate representation.
 */
export function compressDiagramContent(xml: string): string {
  const uriEncoded = encodeURIComponent(xml);
  const deflated = pako.deflateRaw(uriEncoded);
  return Buffer.from(deflated).toString("base64");
}

/**
 * Decompresses a draw.io base64 raw-deflate `<diagram>` payload back into
 * mxGraphModel XML.
 *
 * Throws a clear, catchable error if the input is not valid base64/raw-deflate
 * or does not decode into a valid URI-encoded string.
 */
export function decompressDiagramContent(base64: string): string {
  const trimmed = base64.trim();
  if (trimmed.length === 0) {
    throw new Error("Page could not be decompressed: empty content.");
  }

  let compressed: Buffer;
  try {
    compressed = Buffer.from(trimmed, "base64");
  } catch (error) {
    throw new Error("Page could not be decompressed: invalid base64.", { cause: error });
  }

  let inflated: string;
  try {
    inflated = pako.inflateRaw(compressed, { toText: true });
  } catch (error) {
    throw new Error("Page could not be decompressed: invalid raw-deflate stream.", {
      cause: error,
    });
  }

  try {
    return decodeURIComponent(inflated);
  } catch (error) {
    throw new Error("Page could not be decompressed: invalid URI-encoded content.", {
      cause: error,
    });
  }
}
