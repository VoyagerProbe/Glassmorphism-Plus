export interface TooltipRect { left: number, top: number, right: number, bottom: number }
export type TooltipSide = 'left' | 'right'

/** CSS viewport pixels throughout, including the shell's visible shadow. */
export function placePingTooltip(bounds: TooltipRect, protectedRects: TooltipRect[], x: number, y: number, width: number, height: number, previous?: TooltipSide) {
  const shadow = 8
  const gap = 14 + shadow
  const top = Math.max(bounds.top + shadow, Math.min(y - height / 2, bounds.bottom - height - shadow))
  const fits = (left: number) => {
    const r = { left: left - shadow, right: left + width + shadow, top: top - shadow, bottom: top + height + shadow }
    return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom
      && protectedRects.every(p => r.right <= p.left || r.left >= p.right || r.bottom <= p.top || r.top >= p.bottom)
  }
  const candidates = { left: x - gap - width, right: x + gap }
  const preferred = previous ?? (x > (bounds.left + bounds.right) / 2 ? 'left' : 'right')
  const alternate = preferred === 'left' ? 'right' : 'left'
  for (const side of [preferred, alternate] as const) {
    if (fits(candidates[side]))
      return { mode: side, left: candidates[side], top } as const
  }
  // An invalid side is never clamped back across the selected time band.
  return { mode: 'docked' } as const
}
