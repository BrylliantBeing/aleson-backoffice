/**
 * Geometry shared by the counter's typed dropdown fields (ID type, email).
 *
 * Extracted so the two fields cannot drift: they open in the same places on the
 * same screen, and a list that measures its room differently from its neighbour
 * is the kind of difference nobody notices until one of them opens off-screen.
 */

import { Platform } from "react-native";

export const ROW_HEIGHT = 30;
export const LIST_MAX = ROW_HEIGHT * 5;

export interface DropPlacement {
  /** True when the list has to open upward to stay in view. */
  flip: boolean;
  /** Tallest the list may be without being clipped. */
  max: number;
}

/**
 * Which side of the field the list can open on, and how tall it may be.
 *
 * The passenger table scrolls in its own box, so the thing that would cut the
 * list off is that scroller, not the window — on the last visible row the list
 * has to open upward. Web reads the real clipping ancestors; elsewhere the
 * window is the only bound available synchronously, which is the right answer
 * on a phone anyway.
 */
export const measureDrop = (node: unknown): DropPlacement => {
  const el = node as HTMLElement | null;
  if (Platform.OS !== "web" || !el?.getBoundingClientRect) {
    return { flip: false, max: LIST_MAX };
  }
  const rect = el.getBoundingClientRect();
  let ceiling = 0;
  let floor = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = window.getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
      const box = p.getBoundingClientRect();
      ceiling = Math.max(ceiling, box.top);
      floor = Math.min(floor, box.bottom);
    }
  }
  const below = floor - rect.bottom - 8;
  const above = rect.top - ceiling - 8;
  const flip = below < LIST_MAX && above > below;
  return {
    flip,
    // Never taller than the room it has, so the last row shows whole entries
    // instead of a list sliced through the middle.
    max: Math.max(ROW_HEIGHT * 2, Math.min(LIST_MAX, flip ? above : below)),
  };
};
