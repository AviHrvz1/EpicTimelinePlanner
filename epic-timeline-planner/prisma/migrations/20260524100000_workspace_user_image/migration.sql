-- WorkspaceUser avatar URL. Nullable so existing rows stay valid.
ALTER TABLE "WorkspaceUser" ADD COLUMN "image" TEXT;
