import { useEffect, useId, useRef } from "react";
import { closeLayer, openLayer } from "./back-layers";

/** While `open`, the Back gesture calls `close` (the newest open layer first). */
export function useBackLayer(open: boolean, close: () => void, enabled = true) {
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!enabled || !open) return;
    openLayer(id, () => closeRef.current());
    return () => closeLayer(id);
  }, [id, open, enabled]);
}
