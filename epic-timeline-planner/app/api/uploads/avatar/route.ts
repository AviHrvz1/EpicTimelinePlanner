import { NextRequest, NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/** Hard cap on a single uploaded avatar (bytes). 5 MB. The cropper bakes a
 * relatively small JPEG so real uploads should be well under this; the limit
 * exists to fail-fast on a misbehaving client rather than load a giant file
 * into memory. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function extFromContentType(type: string | null): string {
  if (!type) return "bin";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "bin";
}

export async function POST(request: NextRequest) {
  // The cropper sends a single Blob field named "file" via FormData. Using
  // multipart (rather than raw body) means the browser sets the boundary +
  // we get the original Content-Type even when the upload is a synthesized
  // canvas blob.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  // `form.get` returns `FormDataEntryValue | null`. The Web Fetch standard
  // guarantees uploaded blobs come back as `File` (a `Blob` subclass), but the
  // TS Node types only know about `Blob`, so we check that and read `name` /
  // `type` defensively.
  const file = form.get("file");
  if (!file || typeof file === "string" || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  const type = file.type || "";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: `Unsupported type: ${type || "unknown"}` }, { status: 415 });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes; max ${MAX_AVATAR_BYTES})` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = extFromContentType(type);
  try {
    const url = await getStorage().upload(buffer, ext, { prefix: "avatars" });
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
