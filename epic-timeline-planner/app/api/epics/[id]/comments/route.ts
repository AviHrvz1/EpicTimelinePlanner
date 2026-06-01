import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ACTIVE_RECORD, db } from "@/lib/db";

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  author: z.string().trim().max(120).optional().nullable(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = createCommentSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid comment payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Phase D: no comments on soft-deleted epics.
  const epic = await db.epic.findFirst({ where: { id, ...ACTIVE_RECORD }, select: { id: true } });
  if (!epic) {
    return NextResponse.json({ message: "Epic not found" }, { status: 404 });
  }

  const comment = await db.epicComment.create({
    data: {
      epicId: id,
      body: parsed.data.body,
      author: parsed.data.author ?? null,
    },
  });

  await db.epicHistory.create({
    data: {
      epicId: id,
      entry: "Comment added",
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
