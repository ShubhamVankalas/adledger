import { encode } from "uqr";

/**
 * A QR code as one SVG path (one 1×1 square per dark module), so the page can draw it inline at
 * any size with no image request. Rendered server-side: the otpauth URI never reaches a third party.
 */
export function qrPath(data: string): { size: number; path: string } {
  const qr = encode(data, { ecc: "M", border: 2 });
  let path = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.data[y][x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size: qr.size, path };
}
