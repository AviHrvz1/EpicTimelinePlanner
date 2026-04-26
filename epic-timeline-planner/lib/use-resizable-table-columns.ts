import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pixel widths per column; drag the right edge of each header cell to resize.
 * Resets when `resetKey` changes (e.g. open entity id).
 */
export function useResizableTableColumns(resetKey: string, defaultWidths: readonly number[]) {
  const [widths, setWidths] = useState(() => [...defaultWidths]);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  useEffect(() => {
    setWidths([...defaultWidths]);
  }, [resetKey, defaultWidths]);

  const onColumnResizeStart = useCallback((columnIndex: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const widthAtStart = widthsRef.current[columnIndex];

    function onMove(moveEvent: PointerEvent) {
      const nextW = Math.max(48, widthAtStart + moveEvent.clientX - startX);
      setWidths((prev) => {
        const next = [...prev];
        next[columnIndex] = nextW;
        return next;
      });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return { widths, onColumnResizeStart };
}
