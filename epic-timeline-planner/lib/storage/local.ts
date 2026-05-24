/**
 * Local-disk storage adapter. Writes blobs under `public/uploads/<prefix>/`
 * and returns URLs Next.js serves automatically via its static file handler.
 *
 * Why `public/`: any file under `public/` is exposed at its path verbatim with
 * zero routing — `public/uploads/avatars/abc.jpg` is fetched at
 * `/uploads/avatars/abc.jpg`. No custom Next.js route needed.
 *
 * Persistence model: this is intentionally local-only and not synced anywhere.
 * On the production swap to S3 (or similar) we read each remaining
 * `/uploads/...` URL, push the file up, and rewrite the URL — see
 * `lib/storage/index.ts`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { StorageAdapter, UploadOptions } from "@/lib/storage";
import { sanitizeExtension } from "@/lib/storage";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOADS_ROOT = "uploads";

export class LocalStorageAdapter implements StorageAdapter {
  async upload(data: Buffer, ext: string, opts?: UploadOptions): Promise<string> {
    const prefix = opts?.prefix?.replace(/^\/+|\/+$/g, "") || UPLOADS_ROOT;
    const safeExt = sanitizeExtension(ext);
    const filename = `${randomUUID()}.${safeExt}`;
    const dirAbs = path.join(PUBLIC_DIR, UPLOADS_ROOT, prefix);
    await fs.mkdir(dirAbs, { recursive: true });
    await fs.writeFile(path.join(dirAbs, filename), data);
    // Leading slash means "served from the site root" — Next.js maps this
    // straight to public/.
    return `/${UPLOADS_ROOT}/${prefix}/${filename}`;
  }

  async delete(url: string): Promise<void> {
    // Only act on our own URLs; ignore foreign (e.g. https://) URLs so a stray
    // call can't reach outside the public uploads tree.
    if (!url.startsWith(`/${UPLOADS_ROOT}/`)) return;
    const rel = url.replace(/^\/+/, "");
    const abs = path.join(PUBLIC_DIR, rel);
    // Final guard: ensure the resolved path stays inside the uploads tree
    // (defense in depth against `..` path-traversal in a stored URL).
    const uploadsRoot = path.join(PUBLIC_DIR, UPLOADS_ROOT);
    if (!abs.startsWith(uploadsRoot + path.sep)) return;
    try {
      await fs.unlink(abs);
    } catch {
      // Best-effort: missing file is fine.
    }
  }
}
