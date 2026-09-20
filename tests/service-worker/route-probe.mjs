import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createLab, digest, makeZip, zipFiles } from './lab.mjs'

// Isolation evidence only: this tiny fixture is NOT the shipping implementation.
const shim = `/* plus-sw-route-probe-only */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data === 'PLUS_SW_ROUTE_PROBE' && event.ports[0]) event.ports[0].postMessage('probe-no-fetch');
});
`
const entryPattern = /<script\s[^>]*src=["']([^"']*\/assets\/index-[^"']+\.js)["']/
const moduleErrorPattern = /MIME|module script/
const htmlTypePattern = /text\/html/
const javascriptTypePattern = /javascript/
async function main() {
  const lab = await createLab()
  const browser = await chromium.launch({ headless: true })
  const report = { platform: process.platform, binarySha256: lab.binaryHash, fixtureOnly: true, snapshots: [] }
  const path = resolve(lab.root, 'route-probe.json')
  const save = () => writeFileSync(path, JSON.stringify(report, null, 2))
  const extractEntry = html => html.match(entryPattern)?.[1]
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    const page = await context.newPage()
    const errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && moduleErrorPattern.test(m.text()))
        errors.push(m.text().slice(0, 200))
    })
    async function snapshot(label, response) {
      const state = await page.evaluate(async () => ({
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        active: (await navigator.serviceWorker.getRegistration('/'))?.active?.state ?? null,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.scriptURL, installing: r.installing?.state, waiting: r.waiting?.state })),
        scripts: Array.from(document.scripts, s => s.src).filter(Boolean),
        mounted: Boolean(document.querySelector('#app')?.__vue_app__),
        caches: await caches.keys(),
      }))
      report.snapshots.push({ label, ...state, fromWorker: response?.fromServiceWorker(), status: response?.status() })
      save()
    }
    report.A = await lab.upload(await lab.archive('A'))
    await lab.setTheme('glassmorphism-plus')
    const oldHtml = await (await fetch(lab.base)).text()
    const entryA = extractEntry(oldHtml)
    assert(entryA)
    const official = await (await fetch(`${lab.base}/sw.js`)).arrayBuffer()
    assert.equal(digest(Buffer.from(official)), 'fd95bcb0ac27ebd032d3afd1f76379a6b8361b7d0ec4ef3046a55aa8b83b251a')
    // The genuine official admin frontend registers its genuine Worker normally.
    await page.goto(`${lab.base}/admin`, { waitUntil: 'load' })
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.active?.state === 'activated' && navigator.serviceWorker.controller)), { timeout: 120000 }).toBe(true)
    await snapshot('Official registration activated on admin')
    let controlledA = await page.goto(lab.base)
    await snapshot('First normal navigation to A', controlledA)
    if (!controlledA.fromServiceWorker()) {
      controlledA = await page.reload()
      await snapshot('Second normal navigation to A', controlledA)
    }
    assert(controlledA.fromServiceWorker())
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await snapshot('A official worker controls genuine v2.8.1', controlledA)
    const cachedIndex = await page.evaluate(async () => {
      const name = `workbox-precache-v2-${location.origin}/`
      const cache = await caches.open(name)
      const request = (await cache.keys()).find(r => new URL(r.url).pathname === '/index.html')
      return { name, url: request?.url, body: request ? await (await cache.match(request)).text() : '' }
    })
    assert(cachedIndex.body.includes(entryA))
    report.cachedIndex = { name: cachedIndex.name, url: cachedIndex.url, entry: entryA, htmlSha256: digest(cachedIndex.body) }
    await page.evaluate(async () => {
      localStorage.setItem('plus-sw-sentinel', 'preserve-settings')
      document.cookie = 'plus_sw_sentinel=preserve-cookie; Path=/; SameSite=Lax'
      const cache = await caches.open('unrelated-sentinel')
      await cache.put('/sentinel', new Response('preserve-cache'))
    })
    const zipB = await lab.archive('B')
    report.B = await lab.upload(zipB)
    const currentHtml = await (await fetch(lab.base)).text()
    const entryB = extractEntry(currentHtml)
    assert(entryB && entryB !== entryA)
    const failed = await page.reload({ waitUntil: 'load' })
    assert(failed.fromServiceWorker())
    assert((await failed.text()).includes(entryA))
    const missing = await fetch(lab.base + entryA)
    assert.match(missing.headers.get('content-type'), htmlTypePattern)
    assert((await missing.text()).includes(entryB))
    await page.waitForFunction(() => !document.querySelector('#app')?.__vue_app__)
    assert(errors.length, 'Real module MIME regression was not reproduced')
    report.baselineError = errors[0]
    await snapshot('B stale A navigation causes genuine missing-module failure', failed)
    const files = zipFiles(zipB)
    files.set('dist/sw.js', Buffer.from(shim))
    files.set('dist/plus-recovery.html', Buffer.from('<!doctype html><html lang="en"><title>Route probe</title><body>Independent route probe</body></html>'))
    const candidate = await makeZip(files, resolve(lab.root, 'C-route-probe.zip'))
    report.C = await lab.upload(candidate)
    for (const suffix of ['/sw.js', '/sw.js?known-query=1']) {
      const response = await fetch(lab.base + suffix, { redirect: 'error' })
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type'), javascriptTypePattern)
      assert.equal(await response.text(), shim)
    }
    const recovery = await page.goto(`${lab.base}/themes/glassmorphism-plus/dist/plus-recovery.html`)
    assert.equal(recovery.fromServiceWorker(), false, 'Recovery route was intercepted')
    assert.equal(await page.locator('body').textContent(), 'Independent route probe')
    await snapshot('Old profile reaches independent route', recovery)
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration('/')).update()
    })
    await snapshot('Update returned; activation not assumed')
    report.workerContexts = await Promise.all(context.serviceWorkers().map(async w => ({ url: w.url(), state: await w.evaluate(() => ({ registration: globalThis.registration.scope })).catch(() => null) })))
    report.waitingAck = await page.evaluate(async () => {
      const worker = (await navigator.serviceWorker.getRegistration('/'))?.waiting
      if (!worker)
        return 'none'
      return new Promise((done) => {
        const channel = new MessageChannel()
        const timer = setTimeout(done, 1000, 'timeout')
        channel.port1.onmessage = (event) => {
          clearTimeout(timer)
          done(event.data)
          channel.port1.close()
        }
        worker.postMessage('PLUS_SW_ROUTE_PROBE', [channel.port2])
      })
    })
    save()
    await expect.poll(() => page.evaluate(async () => {
      const worker = navigator.serviceWorker.controller
      if (!worker)
        return false
      return new Promise((done) => {
        const channel = new MessageChannel()
        const timer = setTimeout(() => {
          channel.port1.close()
          done(false)
        }, 500)
        channel.port1.onmessage = (event) => {
          clearTimeout(timer)
          channel.port1.close()
          done(event.data === 'probe-no-fetch')
        }
        worker.postMessage('PLUS_SW_ROUTE_PROBE', [channel.port2])
      })
    }), { timeout: 30000 }).toBe(true).catch(async (error) => {
      await snapshot('Update did not become compatible controller')
      throw error
    })
    const recovered = await page.goto(lab.base)
    assert.equal(recovered.fromServiceWorker(), false)
    assert((await recovered.text()).includes(entryB))
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await snapshot('C no-fetch fixture returns current B bytes', recovered)
    const preserved = await page.evaluate(async () => ({ local: localStorage.getItem('plus-sw-sentinel'), cookie: document.cookie.includes('plus_sw_sentinel=preserve-cookie'), unrelated: await (await (await caches.open('unrelated-sentinel')).match('/sentinel')).text() }))
    assert.deepEqual(preserved, { local: 'preserve-settings', cookie: true, unrelated: 'preserve-cache' })
    report.preserved = preserved
    report.proved = ['official fixed backend and genuine A/B installers', 'real original-profile stale shell and MIME error', 'same script URL theme override including query', 'independent recovery route accessible under old registration', 'real Worker update/activation to no-fetch fixture, no clearing', 'current JS rather than stale mounted UI']
    report.pending = ['shipping compatibility implementation', 'default-theme roundtrip', 'full data and admin safety matrix', 'restricted listener behavior', 'Linux result if platform is not linux', 'Safari physical device']
    save()
    process.stdout.write(`${JSON.stringify({ report: path, ...report }, null, 2)}\n`)
  }
  catch (error) {
    report.failure = String(error)
    save()
    throw error
  }
  finally {
    await browser.close()
    await lab.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
