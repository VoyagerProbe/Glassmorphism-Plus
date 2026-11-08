/** One tab stop per timeline; arrows move through actual point-bound controls. */
export function movePingRailFocus(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return
  const target = event.target
  if (!(target instanceof HTMLElement) || !(event.currentTarget instanceof HTMLElement))
    return
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key))
    return
  const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-node-ping-bar]'))
  const i = cells.indexOf(target)
  if (i < 0)
    return
  event.preventDefault()
  event.stopPropagation()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cells.length - 1 : i + (event.key === 'ArrowLeft' ? -1 : 1)
  cells[Math.min(cells.length - 1, Math.max(0, next))]?.focus()
}

/**
 * Some touch engines promote a tap in a 2px gap to the nearest button.
 * Only accept that button if the physical contact was inside its hitbox.
 * Keyboard activation has no physical coordinates and goes through unchanged.
 */
export function rejectRetargetedRailTap(event: MouseEvent | TouchEvent): void {
  if (event.type === 'click' && event.detail === 0)
    return
  if (!(event.target instanceof HTMLElement))
    return
  const button = event.target.closest<HTMLElement>('[data-node-ping-bar]')
  const point = 'changedTouches' in event ? event.changedTouches[0] : event
  if (!point)
    return
  const physicalTarget = document.elementFromPoint(point.clientX, point.clientY)
  // WebKit can deliver touchend to the gap itself, then synthesize mouse
  // events at different (neighbor-centred) coordinates. Cancel that default
  // here, while the physical contact is still available.
  if (button ? button.contains(physicalTarget) : !('changedTouches' in event))
    return
  if (event.cancelable)
    event.preventDefault()
  event.stopPropagation()
}
