import { useCallback, useRef, useState } from "react";

/**
 * Misst per ResizeObserver die Breite des Elements, an das `ref` gebunden
 * wird -- unabhängig vom Browser-Viewport. Dient den Widgets dazu, ihr
 * Layout an die tatsächliche Panel-Breite anzupassen (Container-Query),
 * statt an `window.innerWidth` (Viewport-Query, wie `useIsMobile`).
 *
 * Callback-Ref statt useEffect(ref): funktioniert auch, wenn der Knoten
 * erst nach bedingtem Rendering entsteht. Erste Messung erfolgt synchron
 * beim Mount, damit es keinen Layout-Sprung "erst breit, dann schmal" gibt.
 *
 * @returns {[(node: HTMLElement|null) => void, number]} [ref, width]
 */
export function useContainerWidth() {
  const [width, setWidth] = useState(0);
  const roRef = useRef(null);

  const ref = useCallback((node) => {
    roRef.current?.disconnect();
    if (!node) return;
    roRef.current = new ResizeObserver(([entry]) => {
      const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setWidth(w);
    });
    roRef.current.observe(node);
    setWidth(node.getBoundingClientRect().width);
  }, []);

  return [ref, width];
}
