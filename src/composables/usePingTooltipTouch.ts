import type { Ref } from 'vue'
import { watch } from 'vue'

// Local CSS-pixel gesture limits, not device/screenshot pixels.
const TAP_DISTANCE = 8
const TAP_DURATION = 400
const COMPATIBILITY_MOUSE_WINDOW = 500

interface TapCandidate {
  pointerId: number
  touchId: number | null
  content: HTMLElement
  x: number
  y: number
  started: number
  maxDistance: number
  scrollTop: number
  scrolled: boolean
}

/** Delegation survives formatter DOM replacement; it never owns chart data. */
export function usePingTooltipTouch(host: Ref<HTMLElement | null>, enabled: Readonly<Ref<boolean>>, hide: () => void) {
  let tap: TapCandidate | null = null
  let suppressed: { x: number, y: number, at: number } | null = null
  let lastScroll = -Infinity
  let stopMultiTouchWatch: (() => void) | null = null
  const cancel = () => {
    tap = null
    stopMultiTouchWatch?.()
    stopMultiTouchWatch = null
  }
  const reset = () => {
    cancel()
    suppressed = null
  }

  watch([host, enabled], ([element, active], _, onCleanup) => {
    reset()
    if (!element || !active)
      return
    const supportsTouchEvents = 'ontouchstart' in window
    const selectedText = () => {
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed && element.contains(selection.anchorNode))
    }
    const contentAt = (target: EventTarget | null) => {
      const shell = target instanceof Element ? target.closest('.ping-shared-tooltip-shell') : null
      if (!shell || !element.contains(shell))
        return null
      const style = getComputedStyle(shell)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return null
      return shell.querySelector<HTMLElement>('[data-ping-shared-tooltip]')
    }
    const begin = (target: EventTarget | null, x: number, y: number, pointerId: number) => {
      const content = contentAt(target)
      if (!content || selectedText() || performance.now() - lastScroll < 120)
        return
      const box = content.getBoundingClientRect()
      // Native scrollbar/gutter is not tappable content. Dragging it must scroll.
      if (x >= box.left + content.clientLeft + content.clientWidth && x <= box.right)
        return
      tap = { pointerId, touchId: null, content, x, y, started: performance.now(), maxDistance: 0, scrollTop: content.scrollTop, scrolled: false }
      // Only while this local tap is pending: notice a second finger even if it
      // starts and ends outside the owner before the first finger is released.
      const additionalPointer = (event: PointerEvent) => {
        if (event.pointerType === 'touch' && event.pointerId !== tap?.pointerId)
          cancel()
      }
      const additionalTouch = (event: TouchEvent) => {
        if (event.touches.length > 1)
          cancel()
      }
      window.addEventListener('pointerdown', additionalPointer, { capture: true, passive: true })
      window.addEventListener('touchstart', additionalTouch, { capture: true, passive: true })
      stopMultiTouchWatch = () => {
        window.removeEventListener('pointerdown', additionalPointer, true)
        window.removeEventListener('touchstart', additionalTouch, true)
      }
    }
    const move = (x: number, y: number) => {
      if (!tap)
        return
      tap.maxDistance = Math.max(tap.maxDistance, Math.hypot(x - tap.x, y - tap.y))
      tap.scrolled ||= tap.scrollTop !== tap.content.scrollTop
    }
    const finish = (event: Event, x: number, y: number) => {
      move(x, y)
      const candidate = tap
      cancel()
      if (!candidate || !candidate.content.isConnected || !element.contains(candidate.content)
        || candidate.maxDistance > TAP_DISTANCE || candidate.scrolled || selectedText()
        || performance.now() - candidate.started > TAP_DURATION) {
        return
      }
      // Prevent only this confirmed tap's default compatibility click, never a drag.
      if (event.cancelable)
        event.preventDefault()
      event.stopImmediatePropagation()
      hide()
      suppressed = { x, y, at: performance.now() }
    }
    const pointerDown = (event: PointerEvent) => {
      // A new independent input is immediately allowed after a dismissed tap.
      suppressed = null
      if (event.pointerType !== 'touch')
        return
      if (!event.isPrimary || tap) {
        cancel()
        return
      }
      begin(event.target, event.clientX, event.clientY, event.pointerId)
    }
    const pointerMove = (event: PointerEvent) => {
      if (tap?.pointerId === event.pointerId)
        move(event.clientX, event.clientY)
    }
    const pointerUp = (event: PointerEvent) => {
      if (tap?.pointerId !== event.pointerId)
        return
      // On touch browsers, touchend also exposes fingers outside this container.
      // Decide there, after pointerup, so multi-touch never becomes a false tap.
      if (!supportsTouchEvents)
        finish(event, event.clientX, event.clientY)
    }
    const touchStart = (event: TouchEvent) => {
      suppressed = null
      if (event.touches.length !== 1) {
        cancel()
        return
      }
      const point = event.changedTouches[0]
      if (!point)
        return
      if (!('PointerEvent' in window))
        begin(event.target, point.clientX, point.clientY, point.identifier)
      if (tap)
        tap.touchId = point.identifier
    }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancel()
        return
      }
      const point = Array.from(event.touches).find(p => p.identifier === tap?.touchId)
      if (point)
        move(point.clientX, point.clientY)
    }
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length || event.changedTouches.length !== 1) {
        cancel()
        return
      }
      const point = Array.from(event.changedTouches).find(p => p.identifier === tap?.touchId)
      if (point)
        finish(event, point.clientX, point.clientY)
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.matches('[data-ping-shared-tooltip]'))
        return
      lastScroll = performance.now()
      if (tap)
        tap.scrolled = true
    }
    const suppressMouse = (event: MouseEvent) => {
      if (!suppressed || performance.now() - suppressed.at > COMPATIBILITY_MOUSE_WINDOW)
        return
      if (Math.hypot(event.clientX - suppressed.x, event.clientY - suppressed.y) > TAP_DISTANCE)
        return
      if (event.cancelable)
        event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type === 'click')
        suppressed = null
    }
    const listeners: Array<[string, EventListener, boolean]> = [
      ['pointerdown', pointerDown as EventListener, true],
      ['pointermove', pointerMove as EventListener, true],
      ['pointerup', pointerUp as EventListener, false],
      ['pointercancel', cancel, true],
      ['touchstart', touchStart as EventListener, true],
      ['touchmove', touchMove as EventListener, true],
      ['touchend', touchEnd as EventListener, false],
      ['touchcancel', cancel, true],
      ['scroll', scroll, true],
      ['contextmenu', cancel, true],
      ...['mousemove', 'mousedown', 'mouseup', 'click'].map(type => [type, suppressMouse as EventListener, false] as [string, EventListener, boolean]),
    ]
    for (const [type, listener, passive] of listeners) element.addEventListener(type, listener, { capture: true, passive })
    // Resize/rotation may invalidate the last HTML position; next input reopens it.
    window.addEventListener('resize', hide, { passive: true })
    onCleanup(() => {
      reset()
      for (const [type, listener] of listeners) element.removeEventListener(type, listener, true)
      window.removeEventListener('resize', hide)
    })
  }, { flush: 'post', immediate: true })

  return { reset }
}
