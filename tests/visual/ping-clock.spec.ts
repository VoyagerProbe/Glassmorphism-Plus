import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

test('paused Ping clock drains triggered RPC and Vue commits without consuming future timers', async ({ page }, info) => {
  const start = Date.parse('2026-07-25T12:00:00.000+08:00')
  const fixture = await installKomariFixture(page, {
    fakeTimers: true,
    clockNow: new Date(start).toISOString(),
    nodeCount: 1,
    hideEarth: true,
    nodeCardPingTaskBindings: JSON.stringify({ [PRIMARY_NODE_UUID]: 202 }),
    nodeCardPingFixture: { metric: 'selected-empty', legacy: 'selected-empty' },
  })
  await page.clock.pauseAt(new Date(start))
  await page.goto('/')
  await expect(page.locator('[data-node-ping-task-id="202"]')).toHaveCount(1)
  await fixture.waitForPingRefreshSettled()

  // A deliberately held fixture response reproduces the old helper's missing
  // guarantee without sleeping or changing any product retry/refresh behavior.
  const release = fixture.pausePingResponses()
  try {
    const request = page.waitForRequest(r => r.url().endsWith('/rpc2') && r.postDataJSON()?.method === 'public:queryMetrics')
    await fixture.advanceTime(60_000)
    await request
    const early = await fixture.getPingRefreshDiagnostics()
    expect(early.pendingRpcRoutes).toBeGreaterThan(0)
    expect(early.state.snapshots.some(s => s.refreshing)).toBe(true)
    expect(early.state.now).toBe(start + 60_000)
    await info.attach('old-helper-returned-before-rpc-consumption', { body: JSON.stringify(early), contentType: 'application/json' })
  }
  finally {
    release()
  }
  await fixture.waitForPingRefreshSettled()
  const settled = await fixture.getPingRefreshDiagnostics()
  expect(settled.pendingRpcRoutes).toBe(0)
  expect(settled.state.snapshots.every(s => !s.refreshing)).toBe(true)
  expect(settled.state.now).toBe(start + 60_000)

  const releaseNext = fixture.pausePingResponses()
  let completed = false
  const nextRequest = page.waitForRequest(r => r.url().endsWith('/rpc2') && r.postDataJSON()?.method === 'public:queryMetrics')
  const advancement = fixture.advanceTimeAndDrain(60_000).then(() => {
    completed = true
  })
  try {
    await nextRequest
    const held = await fixture.getPingRefreshDiagnostics()
    expect(held.state.now).toBeGreaterThan(start + 60_000)
    expect(held.state.now).toBeLessThan(start + 120_000)
    expect(completed).toBe(false)
    expect(held.state.snapshots.some(s => s.refreshing)).toBe(true)
  }
  finally {
    releaseNext()
    await advancement
  }
  expect(completed).toBe(true)
  expect(await page.evaluate(() => Date.now())).toBe(start + 120_000)
  await expect(page.locator('[data-node-ping-bars="latency"] [data-node-ping-bar]').last()).toHaveAttribute('data-node-ping-state', 'pending')
})
