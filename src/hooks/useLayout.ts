import { useWindowDimensions } from "react-native";

/** Widths the back office is actually used at: a phone or a narrow split
 *  window, a counter tablet, and the full-screen desk workstation the booking
 *  grid was originally drawn for. */
export const BREAKPOINTS = { medium: 820, wide: 1180 } as const;

export interface Layout {
  width: number;
  /** One column, page scrolls. */
  compact: boolean;
  /** Two columns, page scrolls. */
  medium: boolean;
  /** Three columns sized to the viewport, panels scroll individually. */
  wide: boolean;
  /** Page/card gutter — tight enough that a phone keeps usable line length. */
  gutter: number;
}

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINTS.wide;
  const medium = !wide && width >= BREAKPOINTS.medium;
  const compact = width < BREAKPOINTS.medium;
  return { width, compact, medium, wide, gutter: compact ? 12 : 20 };
}
