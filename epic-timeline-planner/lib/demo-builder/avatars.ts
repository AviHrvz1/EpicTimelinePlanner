/**
 * Demo-builder helper: scan a local folder of avatar images, copy each one
 * to the storage adapter (so it survives across S3 swap), and return the
 * list of resulting public URLs the seeder can attach to WorkspaceUser rows.
 *
 * Source folder is fixed to `~/Downloads/users/` per project ask — the file
 * names there are numeric (LinkedIn-style asset ids) so we don't try to
 * derive display names from them; the seeder pairs each URL with a
 * synthetic name from the pool in `lib/demo-builder/data.ts`.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getStorage } from "@/lib/storage";

const SOURCE_DIR = path.join(os.homedir(), "Downloads", "users");
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Read the source folder, copy every image to `public/uploads/avatars/`
 * (via the storage adapter), and return the resulting public URLs in stable
 * order. Returns `[]` when the folder is missing or empty so the seeder can
 * fall back to initials avatars without crashing.
 */
export async function collectAndUploadDemoAvatars(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(SOURCE_DIR);
  } catch {
    return [];
  }
  const images = entries
    .filter((name) => ALLOWED_EXT.has(path.extname(name).toLowerCase()))
    .sort(); // stable order across runs
  if (images.length === 0) return [];

  const storage = getStorage();
  const urls: string[] = [];
  for (const name of images) {
    const ext = path.extname(name).replace(/^\./, "").toLowerCase();
    const buffer = await fs.readFile(path.join(SOURCE_DIR, name));
    const url = await storage.upload(buffer, ext, { prefix: "avatars" });
    urls.push(url);
  }
  return urls;
}
