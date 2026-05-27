/**
 * Backlog Excel export.
 *
 * Mirrors the year-Gantt PDF export's UX: a click on the Excel button opens a standalone preview window
 * showing the same table the user sees on screen (respecting their column order, visibility, and current
 * filters). The preview window has a toolbar with "Close" and "Download Excel" — the user reviews the
 * data and clicks Download to save an .xls file Excel opens natively.
 *
 * The "Excel" file is an HTML table served as `application/vnd.ms-excel` with an `.xls` extension. Excel
 * imports HTML tables directly, which keeps us dependency-free (no SheetJS / xlsx-populate) while still
 * preserving columns, headers, and basic cell text. Numeric / date cells are emitted as plain values so
 * Excel can parse them with its default cell types.
 */

export type BacklogExcelRow = {
  /** Cell values in the EXACT order they should appear in the export (left → right). */
  cells: string[];
  /** Indent level for the work-item column (0 = root, 1 = epic, 2 = story). Used to nest names in the preview. */
  indent?: number;
  /** Optional CSS color for a small leading dot before the work-item cell (mirrors the team chip). */
  leadDotColor?: string | null;
};

export function exportBacklogToPrintableWindow(args: {
  /** Column header labels in display order. */
  columnLabels: string[];
  /** Rows in display order. Each row's cells[] length must match columnLabels.length. */
  rows: BacklogExcelRow[];
  /** Title shown in the preview header (e.g. "Backlog — All Initiatives"). */
  title: string;
  /** Subtitle/context line, optional. Filter summary, etc. */
  subtitle?: string;
  /** Filename hint for the downloaded .xls (no extension). */
  filename?: string;
}): void {
  const { columnLabels, rows, title, subtitle, filename } = args;
  const safeFilename = (filename ?? "backlog-export").replace(/[^a-z0-9._-]+/gi, "-");

  const html = renderHtml({ columnLabels, rows, title, subtitle, filename: safeFilename });

  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups for this site to export the backlog.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function renderHtml(args: {
  columnLabels: string[];
  rows: BacklogExcelRow[];
  title: string;
  subtitle?: string;
  filename: string;
}): string {
  const { columnLabels, rows, title, subtitle, filename } = args;

  const headerCells = columnLabels.map((label) => `<th>${escapeHtml(label)}</th>`).join("");

  const bodyRows = rows.length === 0
    ? `<tr><td class="empty" colspan="${columnLabels.length}">No rows match the current filters.</td></tr>`
    : rows
        .map((r) => {
          const cells = r.cells
            .map((value, idx) => {
              if (idx === 0) {
                // Work-item column: render indent + optional team dot before the text.
                const indent = Math.max(0, r.indent ?? 0);
                const dot = r.leadDotColor
                  ? `<span class="lead-dot" style="background:${escapeAttr(r.leadDotColor)}"></span>`
                  : "";
                return `<td class="work-item" style="padding-left:${12 + indent * 18}px">${dot}<span>${escapeHtml(value ?? "")}</span></td>`;
              }
              return `<td>${escapeHtml(value ?? "")}</td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

  // Excel-bound HTML table. The same markup is rendered in the preview AND downloaded — Excel opens .xls
  // files containing HTML and produces a proper spreadsheet view.
  const tableMarkup = `
    <table class="backlog-table">
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    /* Wider page so the preview hugs the viewport instead of a narrow
     * fixed column. 96% of the window with a generous cap keeps it from
     * stretching uncomfortably wide on ultrawide monitors. */
    .page { width: 96%; max-width: 1800px; margin: 0 auto; padding: 24px 24px 40px; }
    /* Card panel that wraps title + subtitle + toolbar + table so the
     * whole export sits inside a single rounded surface. */
    .panel {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 8px 20px -10px rgba(15, 23, 42, 0.10);
      overflow: hidden;
    }
    /* Header band of the panel: title/subtitle on the left, buttons on
     * the right — pinned to the top-right of the panel as requested. */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid #e2e8f0;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    }
    .panel-header .header-text { min-width: 0; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .toolbar button {
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
    .toolbar button:hover { background: #f1f5f9; }
    .toolbar button.primary {
      background: linear-gradient(180deg, #16a34a 0%, #15803d 100%);
      color: white;
      border-color: #15803d;
    }
    .toolbar button.primary:hover { filter: brightness(1.05); }

    .title { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 2px 0; color: #0f172a; }
    .subtitle { font-size: 12.5px; color: #475569; margin: 0; }
    .panel-body { padding: 16px 20px 20px; }

    .backlog-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      font-size: 12.5px;
    }
    .backlog-table thead th {
      background: #0897d5;
      color: white;
      text-align: left;
      padding: 9px 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-size: 11px;
      border-bottom: 1px solid #19abeb;
    }
    .backlog-table tbody td {
      padding: 7px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      color: #0f172a;
    }
    .backlog-table tbody tr:nth-child(even) td { background: #fafbfc; }
    .backlog-table tbody td.work-item { display: flex; align-items: center; gap: 8px; font-weight: 500; }
    .backlog-table tbody td.empty { text-align: center; color: #94a3b8; padding: 28px; font-style: italic; }
    .lead-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="panel">
      <div class="panel-header">
        <div class="header-text">
          <h1 class="title">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <div class="toolbar">
          <button type="button" onclick="window.close()">Close</button>
          <button type="button" class="primary" onclick="downloadExcel()">Download Excel</button>
        </div>
      </div>
      <div class="panel-body">
        <div id="excel-content">${tableMarkup}</div>
      </div>
    </div>
  </div>

  <script>
    function downloadExcel() {
      var content = document.getElementById('excel-content').innerHTML;
      // Wrap in an HTML doc; Excel parses it as a single sheet.
      var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
        + '<head><meta charset="utf-8" /><title>${escapeJsString(title)}</title></head>'
        + '<body>' + content + '</body></html>';
      var blob = new Blob([doc], { type: 'application/vnd.ms-excel' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '${escapeJsString(filename)}.xls';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  </script>
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
  return escapeHtml(s);
}

function escapeJsString(s: string): string {
  // Used inside a string literal inside the inline <script>. Escape quotes + backslashes + line breaks.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}
