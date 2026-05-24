/**
 * Storage adapter — abstracts where user-uploaded blobs (currently just
 * avatars) live. The DB stores only the URL string returned by `upload`, so
 * swapping the backend later (S3 / R2 / Supabase / etc.) means writing a new
 * adapter and running a one-time backfill on existing URLs — no schema change.
 *
 * Why an interface instead of just calling fs.writeFile from the API route:
 * the API route should be storage-agnostic so the future S3 swap is a single
 * import change in `getStorage()`.
 */

export interface StorageAdapter {
  /**
   * Persist `data` and return a public URL to fetch it from. `ext` is the file
   * extension *without* a leading dot (e.g. `"jpg"`, `"png"`, `"webp"`).
   * Implementations may sanitize or override the extension if needed.
   */
  upload(data: Buffer, ext: string, opts?: UploadOptions): Promise<string>;
  /**
   * Best-effort delete by URL (the same string previously returned by `upload`).
   * Implementations should be tolerant of missing files — deleting a no-op is
   * not an error condition the caller needs to handle.
   */
  delete(url: string): Promise<void>;
}

export interface UploadOptions {
  /**
   * Subdirectory / key prefix — e.g. `"avatars"` for user avatars. Used by
   * implementations to namespace blobs. Defaults to `"uploads"`.
   */
  prefix?: string;
}

/**
 * Single chokepoint for resolving the active adapter. Today this just returns
 * the local-disk implementation; flipping to S3 later is one import change.
 */
import { LocalStorageAdapter } from "@/lib/storage/local";

let cached: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (cached) return cached;
  cached = new LocalStorageAdapter();
  return cached;
}

/**
 * Sanitize a user-supplied extension down to a short alphanumeric token.
 * Returns `"bin"` for anything that looks suspicious so we never accept
 * something like `"php"` from a crafted multipart filename. Centralized here
 * because both the API route and the adapter want the same rule.
 */
export function sanitizeExtension(ext: string | undefined | null): string {
  if (!ext) return "bin";
  const cleaned = ext.replace(/^\./, "").trim().toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(cleaned)) return "bin";
  // Allow-list image formats we render; anything else gets normalized so the
  // browser doesn't try to interpret it as code via a wrong Content-Type.
  const ALLOWED = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  return ALLOWED.has(cleaned) ? cleaned : "bin";
}
