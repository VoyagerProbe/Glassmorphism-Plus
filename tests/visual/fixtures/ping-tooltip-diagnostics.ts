import type { Page, TestInfo } from '@playwright/test'

const affected = /five modal cycles preserve dual chart|gesture guards reject out-and-back|native Chromium touch drags and release/

// Observational diagnostics only: do not cancel events, change timers, move
// pointers, resize elements, or alter the product's gesture classification.
export async function observeTooltipEvents({ page }: { page: Page }, info: TestInfo) {
  if (!affected.test(info.title))
    return
  await page.addInitScript(() => {
    const records: object[] = []
    const record = (kind: string, details: object) => {
      const shell = document.querySelector<HTMLElement>('.ping-shared-tooltip-shell')
      const content = shell?.querySelector<HTMLElement>('[data-ping-shared-tooltip]')
      records.push({
        at: performance.now(),
        kind,
        ...details,
        display: shell?.style.display,
        scroll: content?.scrollTop,
        pageScroll: scrollY,
      })
      if (records.length > 300)
        records.shift()
    }
    ;(window as any).__pingTooltipDiagnostic = records
    for (const type of ['resize', 'scroll', 'pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'mouseenter', 'mouseleave', 'mouseout']) {
      window.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target : null
        record(type, {
          trusted: event.isTrusted,
          target: target?.tagName,
          className: typeof target?.className === 'string' ? target.className : '',
          x: event instanceof MouseEvent ? event.clientX : undefined,
          y: event instanceof MouseEvent ? event.clientY : undefined,
          touches: 'TouchEvent' in window && event instanceof TouchEvent ? event.touches.length : undefined,
        })
      }, { capture: true, passive: true })
    }
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.target instanceof Element && change.target.matches('.ping-shared-tooltip-shell'))
          record('tooltip-style', { style: change.target.getAttribute('style') })
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] })
  })
}

export async function attachTooltipEvents({ page }: { page: Page }, info: TestInfo) {
  if (!affected.test(info.title) || info.status === info.expectedStatus || page.isClosed())
    return
  const events = await page.evaluate(() => (window as any).__pingTooltipDiagnostic)
  await info.attach('tooltip-event-diagnostic', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
}
