/**
 * Opens a new window with a print-quality rendering of the active Dashboard.
 *
 * The window does NOT auto-print. The user sees the rendered preview first and triggers
 * the print dialog explicitly via the "Print / Save as PDF" button in the toolbar.
 *
 * Approach: rather than rebuild every chart type from data (the dashboard hosts ~15 different
 * visualizations, each with its own renderer), we clone the live canvas DOM and copy the page's
 * stylesheets into the new window. Recharts charts render as inline SVG, sticky notes/HTML
 * widgets ride along verbatim — what you see in the canvas is what prints. Edit-mode chrome
 * (drag handles, resize buttons, X close buttons) is stripped from the clone before rendering.
 *
 * Mirrors the year-gantt-pdf flow: a toolbar with Close + Print buttons, A4 paper preview pages.
 */
export function exportDashboardToPrintableWindow(args: {
  /** The live canvas element to clone (the grid that wraps every chart card). */
  canvas: HTMLElement;
  /** Dashboard name — shown as the title both on screen and in the print header. */
  dashboardName: string;
  /** Optional subtitle, e.g. "12 charts · 2026 plan". */
  subtitle?: string;
}): void {
  const { canvas, dashboardName, subtitle } = args;

  // Snapshot every <style> and <link rel="stylesheet"> in the current document so the cloned
  // DOM inherits the same Tailwind/Next.js styles inside the new window.
  const headStyles = collectDocumentStyles();

  // Deep-clone the canvas and strip the edit-mode chrome that has no place in a printed document.
  const clone = canvas.cloneNode(true) as HTMLElement;
  stripEditChrome(clone);

  const html = renderHtml({
    dashboardName,
    subtitle,
    headStyles,
    bodyHtml: clone.outerHTML,
  });

  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups for this site to export the dashboard.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * Read every stylesheet `<link>` and inline `<style>` from the current document and return
 * a snippet suitable for embedding inside the new window's `<head>`. We resolve `<link href>`
 * to absolute URLs so they load correctly under `about:blank`.
 */
function collectDocumentStyles(): string {
  const parts: string[] = [];
  const nodes = document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
    "link[rel='stylesheet'], style",
  );
  nodes.forEach((node) => {
    if (node.tagName === "LINK") {
      const link = node as HTMLLinkElement;
      const href = link.href;
      if (!href) return;
      parts.push(`<link rel="stylesheet" href="${escapeAttr(href)}" crossorigin="anonymous" />`);
    } else {
      const style = node as HTMLStyleElement;
      parts.push(`<style>${style.textContent ?? ""}</style>`);
    }
  });
  return parts.join("\n");
}

/**
 * Remove edit-mode controls from the cloned subtree: drag/resize handles, the per-card X close
 * button, the rename pencil, the height +/- buttons. We identify them by the `[data-no-print]`
 * marker the dashboard adds in edit mode, plus a few defensive selectors for buttons that exist
 * purely to drive edit interactions.
 */
function stripEditChrome(root: HTMLElement): void {
  root.querySelectorAll("[data-no-print]").forEach((el) => el.remove());
}

/**
 * Build the print preview HTML — wraps the cloned canvas in a paper-sized page with a toolbar
 * (Close / Print) that hides on print, mirroring the year-gantt PDF export's UX.
 */
function renderHtml(args: {
  dashboardName: string;
  subtitle: string | undefined;
  headStyles: string;
  bodyHtml: string;
}): string {
  const { dashboardName, subtitle, headStyles, bodyHtml } = args;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(dashboardName)}</title>
  ${headStyles}
  <style>
    /* A4 portrait at 10mm margins is the same shape as a standard slide / page handout —
       roomy enough for a 3-column dashboard grid to print without horizontal scroll. */
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* The page wrapper matches the printable area so the on-screen preview shows exactly
       how a single sheet will print. */
    .dashboard-pdf-page-wrap {
      max-width: 277mm;
      margin: 0 auto;
      padding: 32px 0;
    }
    .dashboard-pdf-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 12px;
    }
    .dashboard-pdf-toolbar button {
      appearance: none;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 120ms;
    }
    .dashboard-pdf-toolbar button:hover { background: #f1f5f9; }
    .dashboard-pdf-toolbar button.primary {
      background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%);
      color: white;
      border-color: #4338ca;
    }
    .dashboard-pdf-toolbar button.primary:hover { filter: brightness(1.05); }

    .dashboard-pdf-sheet {
      box-sizing: border-box;
      width: 277mm;
      min-height: 190mm;
      padding: 14mm 12mm;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      box-shadow: 0 8px 24px -8px rgba(15, 23, 42, 0.18), 0 2px 4px rgba(15, 23, 42, 0.05);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dashboard-pdf-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .dashboard-pdf-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0;
    }
    .dashboard-pdf-subtitle {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      margin: 0;
    }

    /* Remove the dotted-background canvas backdrop from the cloned subtree — the preview sheet
       is plain white. The selector matches the inline radial-gradient style applied by
       dashboard-page.tsx so we don't have to add a marker class to the live UI. */
    .dashboard-pdf-canvas {
      background: white !important;
      background-image: none !important;
    }
    /* Charts in the live canvas use Tailwind colors, but their shadows/borders sometimes get
       trimmed by Chromium's print rasterizer. Slightly tighten the cards' gap so the printed
       sheet reads as a single composition rather than floating tiles. */
    .dashboard-pdf-canvas .grid {
      page-break-inside: auto;
    }
    /* A4 landscape printable width is ~277mm — divided into 3 columns leaves each chart with
       under 90mm of content area, which is too cramped for axis labels, legends, and bar
       gaps on most visualizations. Fall back to a 2-column grid for the PDF so each chart
       gets ~130mm. Cards that were colSpan=2 or 3 in the live UI still take a full row
       (the browser clamps grid-column span N to the available column count). */
    .dashboard-pdf-canvas .grid-cols-3 {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
    /* Shrink the chart title in each card header so it doesn't dominate the card at print
       scale. Target the header (first direct child of each card) and override the live UI's
       text-sm sizing on its inner spans + cap the leading icon. */
    .dashboard-pdf-canvas [class*="col-span-"] > div:first-child,
    .dashboard-pdf-canvas [class*="col-span-"] > div:first-child span {
      font-size: 11px !important;
    }
    .dashboard-pdf-canvas [class*="col-span-"] > div:first-child svg {
      width: 12px !important;
      height: 12px !important;
    }
    /* Recharts SVGs are emitted with hardcoded pixel width/height attrs matching whatever the
       live container measured at render time — on a wide monitor that's 600-800px, wider than
       the ~470px print card. They have no viewBox, so CSS scaling clips them instead of
       fitting them in.
       Workaround that doesn't touch SVG internals: shrink the chart body (2nd child of each
       card; the 1st is the header) via CSS transform: scale. The chart body's pre-scale width
       is bumped to 1/scale so post-scale it matches the card exactly. The chart inside stays
       at its original pixel coordinates inside the SVG — fully visible, just smaller.
       Scale 0.5 is aggressive but ensures wide live renders fit inside narrow print cards;
       a smaller scale is the only way to guarantee the chart's right edge stays inside the
       card without touching Recharts internals. */
    .dashboard-pdf-canvas [class*="col-span-"] > div:nth-of-type(2) {
      transform: scale(0.6);
      transform-origin: top left;
      width: 166.67% !important;
      height: 166.67% !important;
    }
    /* Pull the chart's x-axis / y-axis tick text down to a readable size at the smaller scale,
       so users can still see the rightmost x-axis labels (the "end of the chart"). */
    .dashboard-pdf-canvas .recharts-cartesian-axis-tick text {
      font-size: 11px !important;
    }
    .dashboard-pdf-canvas .recharts-legend-item-text {
      font-size: 11px !important;
    }

    @media print {
      html, body { background: white; }
      .dashboard-pdf-toolbar { display: none; }
      .dashboard-pdf-page-wrap {
        padding: 0 !important;
        max-width: none !important;
      }
      .dashboard-pdf-sheet {
        width: auto;
        min-height: 0;
        padding: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="dashboard-pdf-page-wrap">
    <div class="dashboard-pdf-toolbar">
      <button type="button" onclick="window.close()">Close</button>
      <button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button>
    </div>
    <section class="dashboard-pdf-sheet">
      <header class="dashboard-pdf-header">
        <h1 class="dashboard-pdf-title">${escapeHtml(dashboardName)}</h1>
        ${subtitle ? `<p class="dashboard-pdf-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </header>
      <div class="dashboard-pdf-canvas">${bodyHtml}</div>
    </section>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
