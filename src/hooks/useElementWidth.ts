import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

/**
 * Measures one element's own width.
 *
 * Window breakpoints answer "how big is the screen", which is the wrong
 * question for a panel sitting in a multi-column grid: the booking screen's
 * passenger table is starved at 1280px wide and roomy at 1024px, because what
 * decides is the share of the grid the panel gets, not the viewport. Anything
 * that has to fit inside a panel should size against this instead.
 *
 * Returns `null` until the first layout pass so callers can fall back to a
 * viewport guess for the initial paint rather than flashing the narrowest form.
 */
export function useElementWidth(): [number | null, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    // Layout fires on every re-render; ignore sub-pixel noise so measuring a
    // panel never becomes its own render loop.
    setWidth((cur) => (cur !== null && Math.abs(cur - w) < 1 ? cur : w));
  }, []);
  return [width, onLayout];
}
