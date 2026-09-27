// Profile pictures and organization logos.
//
// Images are stored in the database (users.avatar, organizations.logo) so installs need no
// volume or object store. The browser crops and resizes to a 256px square before upload;
// the server re-checks everything here and never trusts the declared type. Logos also get a
// PNG copy (organizations.logo_png) for PDF reports.

export const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Largest file the browser accepts before resizing. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** Largest (already resized) image the server stores. */
export const MAX_STORED_BYTES = 300 * 1024;
/** Edge length of the stored square image. */
export const MEDIA_SIZE = 256;

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** The image type from the file's magic bytes, or null for anything else (SVG, HTML, GIF, ...). */
export function sniffImageType(b: Uint8Array): MediaType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export type ValidatedImage = { ok: true; bytes: Uint8Array; type: MediaType } | { ok: false; message: string };

/** Validate an uploaded image (form field value). */
export async function validateImageUpload(file: FormDataEntryValue | null): Promise<ValidatedImage> {
  if (!file || typeof file === "string") return { ok: false, message: "Choose an image to upload." };
  if (file.size === 0) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_STORED_BYTES) return { ok: false, message: "That image is too large. Use one under 2 MB." };
  if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) return { ok: false, message: "Use a PNG, JPG or WebP image." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || type !== file.type) return { ok: false, message: "That file isn't a valid PNG, JPG or WebP image." };
  return { ok: true, bytes, type };
}

/**
 * The PNG copy of an organization logo sent next to the main image (PDF reports read only PNG or
 * JPEG, and the browser usually uploads WebP). Optional: returns null when absent or not a real
 * PNG, and the caller falls back to the main image when that is PNG/JPEG.
 */
export async function validatePngCopy(file: FormDataEntryValue | null): Promise<Uint8Array | null> {
  if (!file || typeof file === "string" || file.size === 0 || file.size > MAX_STORED_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return sniffImageType(bytes) === "image/png" ? bytes : null;
}

/** PNG/JPEG bytes react-pdf can embed for a logo: the PNG copy, else the original if it's PNG/JPEG. */
export function pdfLogoBytes(png: Uint8Array | null, original: Uint8Array | null, originalType: string | null): Uint8Array | null {
  if (png) return png;
  return original && (originalType === "image/png" || originalType === "image/jpeg") ? original : null;
}

/** Cache-busting URL of a stored image, or null when there is none. */
export function mediaUrl(kind: "user" | "org", id: string, updatedAt: Date | string | null | undefined): string | null {
  if (!updatedAt) return null;
  const v = new Date(updatedAt).getTime().toString(36);
  return `/api/media/${kind}/${id}?v=${v}`;
}
