import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

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

  const story = await db.userStory.findUnique({ where: { id }, select: { id: true } });
  if (!story) {
    return NextResponse.json({ message: "Story not found" }, { status: 404 });
  }

  const comment = await db.storyComment.create({
    data: {
      storyId: id,
      body: parsed.data.body,
      author: parsed.data.author ?? null,
    },
  });

  await db.storyHistory.create({
    data: {
      storyId: id,
      entry: "Comment added",
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
