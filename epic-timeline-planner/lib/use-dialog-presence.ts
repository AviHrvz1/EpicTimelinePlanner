import { useEffect, useRef, useState } from "react";

/** Match `epic-dialog-backdrop--exit` / `epic-dialog-panel--exit` duration in globals.css */
export const DIALOG_EXIT_DURATION_MS = 280;

/**
 * Keeps the dialog mounted briefly after `open` becomes false so exit CSS animations can run.
 * Use `onExitComplete` to clear heavy props (e.g. selected entity) after the exit animation so
 * content does not disappear instantly and parent `key` does not need to change on close.
 */
export function useDialogPresence(open: boolean, onExitComplete?: () => void) {
  const [visible, setVisible] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;

  useEffect(() => {
    if (open) {
      setLeaving(false);
      setVisible(true);
      return undefined;
    }

    if (!visible) {
      return undefined;
    }

    setLeaving(true);
    const id = window.setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      onExitCompleteRef.current?.();
    }, DIALOG_EXIT_DURATION_MS);

    return () => clearTimeout(id);
  }, [open, visible]);

  return { visible, leaving };
}
