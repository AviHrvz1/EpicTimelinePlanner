import { NextRequest, NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Hard cap on a single uploaded team logo (bytes). 5 MB — same cap as
 * avatars, since the cropper produces similarly sized output. */
const MAX_TEAM_IMAGE_BYTES = 5 * 1024 * 1024;

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

/**
 * POST /api/uploads/team-image — accepts multipart with a single Blob
 * field "file". Returns `{ url }` pointing at the public path served by
 * Next from `public/uploads/team-images/<uuid>.<ext>`. The DB only stores
 * the URL string, so swapping to S3 later is one import change in
 * `getStorage()`.
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string" || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  const type = file.type || "";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: `Unsupported type: ${type || "unknown"}` }, { status: 415 });
  }
  if (file.size > MAX_TEAM_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes; max ${MAX_TEAM_IMAGE_BYTES})` },
      { status: 413 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = extFromContentType(type);
  try {
    const url = await getStorage().upload(buffer, ext, { prefix: "team-images" });
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
