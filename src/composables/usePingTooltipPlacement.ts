import type { EChartsType, TooltipComponentPositionCallback } from 'echarts'
import type { Ref } from 'vue'
import type { TooltipRect, TooltipSide } from '@/utils/pingTooltipPlacement'
import { format, time } from 'echarts/core'
import { watch } from 'vue'
import { placePingTooltip } from '@/utils/pingTooltipPlacement'

const CLIPPED_OVERFLOW = /auto|scroll|hidden|clip/
const SCROLL_OVERFLOW = /auto|scroll/

// Explicitly share the canvas label's text, font, margin and padding with its
// measured protected rectangle. These are the existing ECharts label defaults.
export const pingTimeLabel = {
  fontSize: 12,
  fontFamily: 'sans-serif',
  padding: [5, 7, 5, 7],
  margin: 3,
  formatter: ({ value }: { value: number | string }) => time.format(Number(value), '{yyyy}-{MM}-{dd} {HH}:{mm}:{ss}', false),
}
type ChartGeometry = Pick<EChartsType, 'getDom' | 'getWidth' | 'getHeight' | 'convertToPixel'>

/**
 * One ECharts-owned HTML shell, appended after the fixed-height plot/legend.
 * Switching CSS positioning keeps the same content, scroll and delegated input.
 * No setOption, resize, data request, cloned formatter or synthetic pointer input.
 */
export function usePingTooltipPlacement(host: Ref<HTMLElement | null>, chart: () => ChartGeometry | null, enabled: Readonly<Ref<boolean>>, dual: Readonly<Ref<boolean>>) {
  let current: { shell: HTMLElement, timestamp: number, y: number } | null = null
  let side: TooltipSide | undefined
  let frame = 0
  let touchInput = false

  const reset = () => {
    if (current)
      current.shell.dataset.pingOpen = 'false'
    current = null
    side = undefined
    cancelAnimationFrame(frame)
    frame = 0
  }
  const layout = (fromPointer = false) => {
    const owner = host.value
    const api = chart()
    if (!current || !owner || !api || !current.shell.isConnected)
      return
    // Reading the in-flow area must not make it jump back into the plot as the
    // user scrolls. Reconsider its mode only on a fresh chart pointer selection.
    if (!fromPointer && current.shell.dataset.pingPlacement === 'docked')
      return
    const { shell, timestamp } = current
    const plot = api.getDom().getBoundingClientRect()
    const sx = plot.width / api.getWidth()
    const sy = plot.height / api.getHeight()
    if (!sx || !sy)
      return
    const viewport = window.visualViewport
    const bounds: TooltipRect = {
      left: Math.max(plot.left, viewport?.offsetLeft ?? 0),
      right: Math.min(plot.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)),
      top: Math.max(plot.top, viewport?.offsetTop ?? 0),
      bottom: Math.min(plot.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)),
    }
    // Include actual clipping ancestors (not a hard-coded modal or page offset).
    for (let el = owner.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (CLIPPED_OVERFLOW.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, rect.left)
        bounds.right = Math.min(bounds.right, rect.right)
      }
      if (CLIPPED_OVERFLOW.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, rect.top)
        bounds.bottom = Math.min(bounds.bottom, rect.bottom)
      }
    }
    const xs = (dual.value ? [0, 1] : [0]).map(xAxisIndex => plot.left + Number(api.convertToPixel({ xAxisIndex }, timestamp)) * sx)
    const bottom = plot.bottom - 52 * sy
    const protectedRects: TooltipRect[] = xs.map(x => ({ left: x - 12, right: x + 12, top: plot.top + 30 * sy, bottom }))
    const label = format.getTextRect(pingTimeLabel.formatter({ value: timestamp }), '12px sans-serif')
    const labelWidth = (label.width + 14) * sx
    const labelHeight = (label.height + 10) * sy
    const labelLeft = Math.max(plot.left, Math.min(xs.at(-1)! - labelWidth / 2, plot.right - labelWidth))
    const labelTop = Math.max(plot.top, Math.min(bottom + 3 * sy, plot.bottom - labelHeight))
    protectedRects.push({ left: labelLeft, right: labelLeft + labelWidth, top: labelTop, bottom: labelTop + labelHeight })
    shell.dataset.pingOpen = 'true'
    const size = shell.getBoundingClientRect()
    const result = placePingTooltip(bounds, protectedRects, xs[0]!, plot.top + current.y * sy, size.width, size.height, side)
    shell.dataset.pingPlacement = result.mode
    shell.dataset.pingTime = String(timestamp)
    if (result.mode !== 'docked') {
      side = result.mode
      const root = owner.getBoundingClientRect()
      owner.style.setProperty('--ping-tooltip-left', `${(result.left - root.left) / sx}px`)
      owner.style.setProperty('--ping-tooltip-top', `${(result.top - root.top) / sy}px`)
    }
  }
  const position: TooltipComponentPositionCallback = (point, params, dom) => {
    const p = (Array.isArray(params) ? params[0] : params) as { axisValue?: number | string, value?: [number, unknown] } | undefined
    const timestamp = Number(p?.axisValue ?? p?.value?.[0])
    if (dom instanceof HTMLElement && Number.isFinite(timestamp)) {
      current = { shell: dom, timestamp, y: point[1] }
      layout(true)
    }
    // Public ECharts appendTo still owns content/show/hide. CSS controls position
    // so its confinement/transform cannot put an invalid candidate across T.
    return [0, 0]
  }
  watch([host, enabled], ([owner, active], _, cleanup) => {
    reset()
    if (!owner || !active)
      return
    const rememberInput = (event: PointerEvent) => {
      touchInput = event.pointerType === 'touch'
    }
    owner.addEventListener('pointerover', rememberInput, { passive: true })
    // Native scroll anchoring can follow the footer when an in-flow data area
    // grows above it. Disable only anchoring on this chart's actual scroller;
    // never lock overflow, change body positioning or write scroll offsets.
    let scroller = owner.parentElement
    while (scroller && !(SCROLL_OVERFLOW.test(getComputedStyle(scroller).overflowY) && (scroller.scrollHeight > scroller.clientHeight + 1 || scroller.matches('[data-app-dialog-body]'))))
      scroller = scroller.parentElement
    scroller ??= document.scrollingElement as HTMLElement
    const anchorValue = scroller.style.getPropertyValue('overflow-anchor')
    const anchorPriority = scroller.style.getPropertyPriority('overflow-anchor')
    scroller.style.setProperty('overflow-anchor', 'none')
    const reposition = (event?: Event) => {
      // Inner data scrolling must not reformat, reposition or cancel its gesture.
      if (event?.target instanceof Element && owner.contains(event.target))
        return
      if (frame)
        return
      frame = requestAnimationFrame(() => {
        frame = 0
        layout()
      })
    }
    window.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.visualViewport?.addEventListener('scroll', reposition, { passive: true })
    cleanup(() => {
      reset()
      owner.removeEventListener('pointerover', rememberInput)
      if (scroller.style.getPropertyValue('overflow-anchor') === 'none') {
        if (anchorValue)
          scroller.style.setProperty('overflow-anchor', anchorValue, anchorPriority)
        else scroller.style.removeProperty('overflow-anchor')
      }
      window.removeEventListener('scroll', reposition, true)
      window.visualViewport?.removeEventListener('scroll', reposition)
    })
  }, { flush: 'post', immediate: true })
  const leave = (hide: () => void) => {
    // This is the entire owner (plot + in-flow area), not canvas mouseleave.
    if (!touchInput)
      hide()
  }
  const hide = (event: { from?: string }) => {
    // ECharts emits an internal hideTip when touch leaves its canvas. The
    // enterable in-flow shell remains owned by this chart; explicit public
    // hide actions and the owner's close/reset paths still dismiss it.
    if (!event.from)
      reset()
  }
  return { position, reset, leave, hide }
}
