/** Prepare stored comment body for display (TipTap HTML or legacy plain text). */
export function commentDisplayHtml(body: string): string {
  const t = body.trim();
  if (!t) return "";
  const head = t.slice(0, 12).toLowerCase();
  if (
    head.startsWith("<p") ||
    head.startsWith("<div") ||
    head.startsWith("<h1") ||
    head.startsWith("<h2") ||
    head.startsWith("<h3") ||
    head.startsWith("<ul") ||
    head.startsWith("<ol") ||
    head.startsWith("<blockquote") ||
    head.startsWith("<img") ||
    head.startsWith("<a") ||
    head.startsWith("<strong") ||
    head.startsWith("<em") ||
    head.startsWith("<u>")
  ) {
    return t;
  }
  const esc = t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${esc.replace(/\n/g, "<br>")}</p>`;
}
