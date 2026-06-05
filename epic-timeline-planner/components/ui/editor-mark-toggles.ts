/**
 * Helpers for the bold / italic / underline toolbar buttons used in every
 * Tiptap editor (initiative / epic / story description, activity composer,
 * sticky notes, retro cards).
 *
 * The bug they fix: `editor.chain().focus().toggleBold().run()` only flips
 * the *stored marks* when there's no selection — it does NOT remove the
 * mark from the existing document. So when the cursor lands inside bold
 * text (e.g. when opening a story whose saved description starts with
 * `<strong>`), the button reads `isActive("bold") === true` and clicking it
 * appears to do nothing because the surrounding bold mark on the document
 * is untouched. Visually it looks like the B button is "stuck on".
 *
 * The fix: when there's no selection AND the mark is active, extend the
 * selection to the full mark range first, THEN toggle. That removes the
 * mark from the whole word/run, matching Word/Notion behavior.
 */

type EditorLike = {
  chain: () => unknown;
  state: { selection: { from: number; to: number } };
  isActive: (name: string) => boolean;
};

type MarkChain = {
  focus: () => MarkChain;
  extendMarkRange: (name: string) => MarkChain;
  toggleMark: (name: string) => MarkChain;
  run: () => boolean;
};

export function toggleMarkSmart(editor: EditorLike | null | undefined, markName: string) {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  const chain = (editor.chain() as MarkChain).focus();
  if (from === to && editor.isActive(markName)) {
    chain.extendMarkRange(markName).toggleMark(markName).run();
  } else {
    chain.toggleMark(markName).run();
  }
}
