// Geometry for the product tour: where the floating card goes relative to the spotlight. Pure, so
// it is unit-tested without a browser.

export type Box = { x: number; y: number; w: number; h: number };
export type Side = "right" | "left" | "top" | "bottom";
export type Preference = Side | "auto";

export type CardPlacement =
  | { kind: "float"; x: number; y: number; side: Side | "inside" }
  | { kind: "dock"; edge: "top" | "bottom" };

export const CARD_MARGIN = 12;
export const CARD_GAP = 14;
/** Narrower than this the card becomes a sheet docked to the top or bottom edge. */
export const COMPACT_WIDTH = 640;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

/**
 * Place a card of `card` size next to `spot` (the padded spotlight box) inside a `vw` x `vh` viewport.
 * `spot` null means "no target": centred. Wide screens float the card on the preferred side when it
 * fits, otherwise the roomiest side, otherwise inside the viewport. Narrow screens dock the card to
 * the edge farther from the target so the target stays visible.
 */
export function placeCard(opts: { spot: Box | null; card: { w: number; h: number }; vw: number; vh: number; prefer?: Preference }): CardPlacement {
  const { spot, card, vw, vh, prefer = "auto" } = opts;
  const m = CARD_MARGIN;
  if (vw < COMPACT_WIDTH) {
    if (!spot) return { kind: "dock", edge: "bottom" };
    return { kind: "dock", edge: spot.y + spot.h / 2 > vh * 0.55 ? "top" : "bottom" };
  }
  if (!spot) return { kind: "float", x: Math.round((vw - card.w) / 2), y: Math.round((vh - card.h) / 2), side: "inside" };

  const space: Record<Side, number> = {
    right: vw - (spot.x + spot.w),
    left: spot.x,
    bottom: vh - (spot.y + spot.h),
    top: spot.y,
  };
  const need: Record<Side, number> = {
    right: card.w + CARD_GAP + m,
    left: card.w + CARD_GAP + m,
    bottom: card.h + CARD_GAP + m,
    top: card.h + CARD_GAP + m,
  };
  const byRoom = (Object.keys(space) as Side[]).sort((a, b) => space[b] - space[a]);
  const order: Side[] = prefer === "auto" ? byRoom : [prefer, ...byRoom.filter((s) => s !== prefer)];
  const side = order.find((s) => space[s] >= need[s]);

  const cx = spot.x + spot.w / 2;
  const cy = spot.y + spot.h / 2;
  const clampX = (x: number) => clamp(x, m, vw - card.w - m);
  const clampY = (y: number) => clamp(y, m, vh - card.h - m);
  switch (side) {
    case "right":
      return { kind: "float", x: spot.x + spot.w + CARD_GAP, y: clampY(cy - card.h / 2), side };
    case "left":
      return { kind: "float", x: spot.x - CARD_GAP - card.w, y: clampY(cy - card.h / 2), side };
    case "bottom":
      return { kind: "float", x: clampX(cx - card.w / 2), y: spot.y + spot.h + CARD_GAP, side };
    case "top":
      return { kind: "float", x: clampX(cx - card.w / 2), y: spot.y - CARD_GAP - card.h, side };
    default:
      // A target as big as the screen: sit inside the viewport, at the edge away from its centre.
      return { kind: "float", x: clampX(cx - card.w / 2), y: cy > vh / 2 ? m : vh - card.h - m, side: "inside" };
  }
}

/** Grow a rect by `pad` on every side. */
export const inflate = (r: Box, pad: number): Box => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

/**
 * How far to scroll the window (positive = down) so a target ends up inside the visible band
 * [top, bottom] of the viewport. 0 when it already is. Targets taller than the band align to its top.
 */
export function scrollDelta(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): number {
  const height = rect.bottom - rect.top;
  const room = band.bottom - band.top;
  if (height >= room) return Math.round(rect.top - band.top);
  if (rect.top < band.top) return Math.round(rect.top - band.top - (room - height) / 2);
  if (rect.bottom > band.bottom) return Math.round(rect.bottom - band.bottom + (room - height) / 2);
  return 0;
}
