import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createLab, digest, makeZip, project, zipFiles } from './lab.mjs'

const entryPattern = /<script\s[^>]*src=["']([^"']*\/assets\/index-[^"']+\.js)["']/
const moduleErrorPattern = /MIME|module script/
const recoveryPath = '/themes/glassmorphism-plus/dist/plus-recovery.html'
const indexKey = '/index.html?__WB_REVISION__=01deecf312fd6fdfacc090ce81267cba'
const javascriptPattern = /javascript/
const htmlPattern = /text\/html/

export function candidateFiles() {
  const files = new Map([
    ['komari-theme.json', readFileSync(resolve(project, 'komari-theme.json'))],
    ['preview.png', readFileSync(resolve(project, 'docs/preview.png'))],
  ])
  function walk(relative) {
    for (const entry of readdirSync(resolve(project, relative), { withFileTypes: true })) {
      assert(!entry.isSymbolicLink())
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory())
        walk(path)
      else
        files.set(path, readFileSync(resolve(project, path)))
    }
  }
  walk('dist')
  for (const name of ['sw.js', 'plus-recovery.html', 'plus-recovery.js'])
    assert.equal(digest(files.get(`dist/${name}`)), digest(readFileSync(resolve(project, 'public', name))))
  return files
}

async function active(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    return Boolean(registration?.active?.state === 'activated' && navigator.serviceWorker.controller)
  })
}

async function compatibility(page) {
  return page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller
    if (!worker)
      return null
    return new Promise((done) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => {
        channel.port1.close()
        done(null)
      }, 700)
      channel.port1.onmessage = (event) => {
        clearTimeout(timer)
        channel.port1.close()
        done(event.data?.compatibilityId)
      }
      worker.postMessage('PLUS_COMPAT_STATUS_V1', [channel.port2])
    })
  })
}

async function seed(page) {
  await page.evaluate(async () => {
    localStorage.setItem('plus-test-favorites', '["synthetic-node"]')
    localStorage.setItem('themeMode', 'dark')
    localStorage.setItem('plus-test-ping-binding', 'synthetic-task')
    document.cookie = 'plus_test_cookie=preserve; Path=/; SameSite=Lax'
    await new Promise((done, fail) => {
      const request = indexedDB.open('plus-test-sentinel', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('settings')
      request.onerror = () => fail(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('settings', 'readwrite')
        transaction.objectStore('settings').put('preserve', 'value')
        transaction.oncomplete = () => {
          database.close()
          done()
        }
      }
    })
    for (const name of ['unrelated-sentinel', 'api-cache']) {
      const cache = await caches.open(name)
      await cache.put('/synthetic-sentinel', new Response('preserve', { headers: { 'Content-Type': 'text/plain' } }))
    }
  })
}

async function sentinels(page) {
  return page.evaluate(async () => ({
    favorites: localStorage.getItem('plus-test-favorites'),
    color: localStorage.getItem('themeMode'),
    binding: localStorage.getItem('plus-test-ping-binding'),
    cookie: document.cookie.includes('plus_test_cookie=preserve'),
    caches: await Promise.all(['unrelated-sentinel', 'api-cache'].map(async name => (await (await caches.open(name)).match('/synthetic-sentinel'))?.text())),
    indexedDB: await new Promise((done, fail) => {
      const request = indexedDB.open('plus-test-sentinel', 1)
      request.onerror = () => fail(request.error)
      request.onsuccess = () => {
        const database = request.result
        const read = database.transaction('settings').objectStore('settings').get('value')
        read.onsuccess = () => {
          database.close()
          done(read.result)
        }
      }
    }),
  }))
}

async function cacheInventory(page) {
  return page.evaluate(async () => {
    const cache = await caches.open(`workbox-precache-v2-${location.origin}/`)
    return Promise.all((await cache.keys()).map(async (request) => {
      const response = await cache.match(request)
      const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
      return [new URL(request.url).pathname + new URL(request.url).search, Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')]
    }))
  })
}

async function main() {
  const lab = await createLab()
  let browser
  const outstanding = new Map()
  const report = { platform: process.platform, binarySha256: lab.binaryHash, cases: [], physicalSafari: 'not-tested', fixture: 'genuine v2.8.1 A; B is current built product with compatibility resources removed; C is current build; D changes the real entry filename and bytes' }
  const record = (name, result) => {
    report.cases.push({ name, ...result })
    writeFileSync(resolve(lab.root, 'migration.json'), JSON.stringify(report, null, 2))
    process.stdout.write(`${name}: ${JSON.stringify(result)}\n`)
  }
  try {
    browser = await chromium.launch({ headless: true })
    const filesC = candidateFiles()
    const zipC = await makeZip(filesC, resolve(lab.root, 'C.zip'))
    const filesB = new Map(filesC)
    for (const name of ['sw.js', 'plus-recovery.html', 'plus-recovery.js']) filesB.delete(`dist/${name}`)
    const zipB = await makeZip(filesB, resolve(lab.root, 'B-test-only.zip'))
    const zipA = await lab.archive('A')
    const entryA = zipFiles(zipA).get('dist/index.html').toString().match(entryPattern)[1]
    const entryC = filesC.get('dist/index.html').toString().match(entryPattern)[1]
    assert.notEqual(entryA, entryC)
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    context.on('request', request => outstanding.set(request, { host: new URL(request.url()).hostname, path: new URL(request.url()).pathname, worker: Boolean(request.serviceWorker()) }))
    context.on('requestfinished', request => outstanding.delete(request))
    context.on('requestfailed', request => outstanding.delete(request))
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error' && moduleErrorPattern.test(message.text()))
        errors.push(message.text().slice(0, 190))
    })
    await lab.upload(zipA)
    await lab.setTheme('glassmorphism-plus')
    assert.equal(digest(Buffer.from(await (await fetch(`${lab.base}/sw.js`)).arrayBuffer())), 'fd95bcb0ac27ebd032d3afd1f76379a6b8361b7d0ec4ef3046a55aa8b83b251a')
    await page.goto(`${lab.base}/admin`)
    await expect.poll(() => active(page), { timeout: 120000 }).toBe(true)
    const old = await page.goto(lab.base)
    assert(old.fromServiceWorker())
    assert((await old.text()).includes(entryA))
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await seed(page)
    lab.fixtureFile('sw-test-unrelated/worker.js', 'globalThis.addEventListener("install", e => e.waitUntil(globalThis.skipWaiting())); globalThis.addEventListener("activate", e => e.waitUntil(globalThis.clients.claim()));')
    lab.fixtureFile('sw-test-unrelated/page.html', '<!doctype html><title>Unrelated synthetic app</title><script>navigator.serviceWorker.register("./worker.js")</script>')
    const unrelated = await context.newPage()
    await unrelated.goto(`${lab.base}/sw-test-unrelated/page.html`)
    await unrelated.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw-test-unrelated/worker.js'))
    const before = await sentinels(page)
    const inventory = await cacheInventory(page)
    assert.equal(new Map(inventory).get(indexKey), '442422019562099f6c7200fa42882823278afaaaa45882b263b00469ba649d47')
    await lab.upload(zipB)
    const failed = await page.reload()
    assert(failed.fromServiceWorker())
    assert((await failed.text()).includes(entryA))
    await expect.poll(() => errors.length).toBeGreaterThan(0)
    const missing = await fetch(lab.base + entryA)
    assert.match(missing.headers.get('content-type'), htmlPattern)
    record('real stale profile regression', { oldEntry: entryA, currentEntry: entryC, fromWorker: true, moduleMimeFailure: true })

    // A second foreground tab and an in-progress form must not be navigated.
    const other = await context.newPage()
    await other.goto(lab.base)
    const admin = await context.newPage()
    await admin.goto(`${lab.base}/admin/settings/site`)
    await admin.getByPlaceholder('admin', { exact: true }).fill(lab.credentials.username)
    await admin.locator('input[type="password"]').fill(lab.credentials.password)
    await admin.getByRole('button', { name: '登录', exact: true }).last().click()
    await admin.waitForFunction(() => !document.querySelector('input[type="password"]'))
    await admin.goto(`${lab.base}/admin/settings/site`)
    await admin.locator('input[type="text"]').first().waitFor()
    await expect(admin.locator('input[type="text"]').first()).toHaveValue('Synthetic SW Lab')
    await admin.keyboard.press('Escape')
    await admin.locator('input[type="text"]').first().fill('preserve-unsaved-form')
    await expect(admin.locator('input[type="text"]').first()).toHaveValue('preserve-unsaved-form')
    let otherNavigations = 0
    let adminNavigations = 0
    other.on('framenavigated', (frame) => {
      if (frame === other.mainFrame())
        otherNavigations++
    })
    admin.on('framenavigated', (frame) => {
      if (frame === admin.mainFrame())
        adminNavigations++
    })
    await lab.upload(zipC)
    for (const suffix of ['/sw.js', '/sw.js?existing-query=1']) {
      const response = await fetch(lab.base + suffix, { redirect: 'error' })
      assert.match(response.headers.get('content-type'), javascriptPattern)
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(filesC.get('dist/sw.js')))
    }
    const recovery = await page.goto(lab.base + recoveryPath)
    assert.equal(recovery.fromServiceWorker(), false)
    await page.locator('#update').click()
    await expect(page.locator('#status')).toContainText('已完成：', { timeout: 55000 })
    assert.equal(adminNavigations, 0)
    assert.equal(otherNavigations, 0)
    assert.equal(await admin.locator('input[type="text"]').first().inputValue(), 'preserve-unsaved-form')
    assert.deepEqual(await sentinels(page), before)
    assert.equal(await unrelated.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${lab.base}/sw-test-unrelated/worker.js`)
    const afterInventory = await cacheInventory(page)
    assert.deepEqual(afterInventory, inventory.filter(([key]) => key !== indexKey))
    record('independent recovery and exact-only invalidation', { activated: true, noOtherNavigation: true, sentinelsUnchanged: true, removedEntries: [indexKey], otherPrecacheEntriesUnchanged: afterInventory.length })
    await page.locator('#home').click()
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert((await page.content()).includes(entryC))
    const current = await page.reload()
    assert.equal(current.fromServiceWorker(), false)
    record('current candidate boot', { correctEntry: entryC, fromWorker: false })
    await admin.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect.poll(async () => (await lab.request('/api/admin/settings/', { auth: true })).data.sitename).toBe('preserve-unsaved-form')
    for (const route of ['/admin/settings/site', '/terminal/synthetic-node', '/manage']) {
      const response = await admin.goto(lab.base + route)
      assert(response.ok())
      assert.equal(response.fromServiceWorker(), false)
    }
    assert.equal(digest(Buffer.from(await (await lab.request('/sw.js', { auth: true, raw: true })).arrayBuffer())), digest(filesC.get('dist/sw.js')))
    record('online admin and root worker stability', { realUiLogin: true, realUnsavedSiteFormPreserved: true, settingsSaveConfirmedByBackend: true, terminalAndManageRoutes: true, authenticatedWorkerBytesUnchanged: true, liveAgentTerminalNotTested: true })

    const filesD = new Map(filesC)
    const oldEntryFile = `dist${entryC}`
    const bytesD = Buffer.concat([filesD.get(oldEntryFile), Buffer.from('\n/* next-build fixture, never released */\n')])
    const entryD = `/assets/index-${digest(bytesD).slice(0, 12)}.js`
    filesD.set(`dist${entryD}`, bytesD)
    filesD.delete(oldEntryFile)
    filesD.set('dist/index.html', Buffer.from(filesD.get('dist/index.html').toString().replaceAll(entryC, entryD)))
    await lab.upload(await makeZip(filesD, resolve(lab.root, 'D-test-only.zip')))
    const future = await page.reload()
    assert.equal(future.fromServiceWorker(), false)
    assert((await future.text()).includes(entryD))
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert.deepEqual(await sentinels(page), before)
    record('same profile next build', { entryChanged: true, bytesChanged: true, mounted: true, sentinelsUnchanged: true })

    await lab.setTheme('default')
    await page.goto(lab.base + recoveryPath)
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      window.__previousWorker = registration.active
      await registration.update()
    })
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      return registration.active !== window.__previousWorker && registration.active?.state === 'activated'
    }), { timeout: 30000 }).toBe(true)
    const official = await page.goto(lab.base)
    assert(official.fromServiceWorker())
    assert(!(await official.text()).includes(entryA))
    assert(!(await official.text()).includes(entryC))
    assert((await official.text()).includes('entry-index-'))
    await lab.setTheme('glassmorphism-plus')
    await page.goto(lab.base + recoveryPath)
    await page.locator('#update').click()
    await expect(page.locator('#status')).toContainText('已完成：', { timeout: 55000 })
    await page.locator('#home').click()
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert((await page.content()).includes(entryD))
    assert.deepEqual(await sentinels(page), before)
    record('official and Plus roundtrip', { officialMountedShell: true, plusCorrectEntry: true, sentinelsUnchanged: true })
    await context.close()

    const fresh = await browser.newContext()
    const freshPage = await fresh.newPage()
    await freshPage.goto(`${lab.base}${recoveryPath}?return=https%3A%2F%2Fexample.invalid`)
    await freshPage.locator('#update').click()
    await expect(freshPage.locator('#status')).toContainText('没有发现旧根组件')
    assert.equal(await freshPage.locator('#home').getAttribute('href'), `${lab.base}/`)
    assert.equal(await freshPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0)
    await fresh.setOffline(true)
    await freshPage.locator('#update').click()
    await expect(freshPage.locator('#status')).toContainText('当前离线')
    await fresh.setOffline(false)
    await freshPage.locator('#home').click()
    await freshPage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await expect(freshPage.locator('#plus-startup-help')).toBeHidden()
    record('new visitor, offline and redirect boundary', { noNewRegistration: true, offlineNotSuccess: true, fixedSameOriginReturn: true })
    await fresh.close()

    // Fault injection is limited to the supplemental new-HTML startup message;
    // the migration cases above always use real installed files and workers.
    const entryFailure = await browser.newContext()
    const entryFailurePage = await entryFailure.newPage()
    await entryFailure.route(`**${entryD}`, route => route.abort('failed'))
    await entryFailurePage.goto(lab.base)
    await expect(entryFailurePage.locator('#plus-startup-help')).toBeVisible()
    await entryFailure.close()
    const apiFailure = await browser.newContext()
    await apiFailure.route('**/api/**', route => route.abort('failed'))
    const apiFailurePage = await apiFailure.newPage()
    await apiFailurePage.goto(lab.base)
    await apiFailurePage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await expect(apiFailurePage.locator('#plus-startup-help')).toBeHidden()
    await apiFailure.close()
    record('supplemental new HTML guard', { entryFailureShowsRecovery: true, apiFailureDoesNotTriggerRecovery: true, faultInjectionOnlyInThisCase: true })

    const unsupported = await browser.newContext()
    await unsupported.addInitScript(() => Object.defineProperty(navigator, 'serviceWorker', { value: undefined }))
    const unsupportedPage = await unsupported.newPage()
    await unsupportedPage.goto(lab.base + recoveryPath)
    await expect(unsupportedPage.locator('#update')).toBeDisabled()
    await unsupportedPage.locator('#home').click()
    await unsupportedPage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await unsupported.close()
    const denied = await browser.newContext()
    await denied.addInitScript(() => Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.reject(new DOMException('Synthetic storage denial', 'SecurityError')) } }))
    const deniedPage = await denied.newPage()
    await deniedPage.goto(lab.base + recoveryPath)
    await deniedPage.locator('#update').click()
    await expect(deniedPage.locator('#status')).toContainText('未完成：')
    await deniedPage.locator('#home').click()
    await deniedPage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    await denied.close()
    record('browser capability fallbacks', { noSwApiBoots: true, storageDeniedBoots: true, syntheticApiDenialOnly: true })

    lab.fixtureFile('sw-test-unknown.js', 'globalThis.addEventListener("install", e => e.waitUntil(globalThis.skipWaiting())); globalThis.addEventListener("activate", e => e.waitUntil(globalThis.clients.claim()));')
    const unknown = await browser.newContext()
    const unknownPage = await unknown.newPage()
    await unknownPage.goto(lab.base + recoveryPath)
    await unknownPage.evaluate(() => navigator.serviceWorker.register('/sw-test-unknown.js', { scope: '/' }))
    await unknownPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await unknownPage.locator('#update').click()
    await expect(unknownPage.locator('#status')).toContainText('不是本实例已知组件地址')
    assert.equal(await unknownPage.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${lab.base}/sw-test-unknown.js`)
    await unknown.close()
    record('unrelated registrations', { differentScopeWorkerPreserved: true, unknownRootWorkerRefused: true })

    // Independent profile: no recovery-page click or manual update invocation.
    await lab.upload(zipA)
    const natural = await browser.newContext({ serviceWorkers: 'allow' })
    const naturalPage = await natural.newPage()
    await naturalPage.goto(`${lab.base}/admin`)
    await expect.poll(() => active(naturalPage), { timeout: 120000 }).toBe(true)
    // Existing query-bearing registration is set up while A is installed.
    // After C installation, only the browser's natural update check is used.
    await naturalPage.evaluate(() => navigator.serviceWorker.register('/sw.js?existing-query=1', { scope: '/' }))
    await expect.poll(() => naturalPage.evaluate(() => navigator.serviceWorker.controller?.scriptURL), { timeout: 30000 }).toBe(`${lab.base}/sw.js?existing-query=1`)
    assert((await (await naturalPage.goto(lab.base)).text()).includes(entryA))
    await lab.upload(zipB)
    assert((await (await naturalPage.reload()).text()).includes(entryA))
    await lab.upload(zipC)
    const firstVisit = await naturalPage.reload()
    const firstVisitHtml = await firstVisit.text()
    await expect.poll(() => compatibility(naturalPage), { timeout: 30000 }).toBe('plus-online-v1')
    const afterActivation = await naturalPage.reload()
    assert.equal(afterActivation.fromServiceWorker(), false)
    assert((await afterActivation.text()).includes(entryC))
    await naturalPage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert.equal(await naturalPage.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${lab.base}/sw.js?existing-query=1`)
    record('natural update independent old profile', { manualUpdateCalled: false, existingQueryPreserved: true, firstNavigationWasStale: firstVisitHtml.includes(entryA), furtherNavigationAfterActivation: 1, correctCurrentEntry: true })
    await lab.restartMode(true)
    assert.equal((await fetch(lab.base + recoveryPath)).status, 404)
    assert.equal((await fetch(lab.base + recoveryPath, { headers: { Cookie: lab.cookie } })).status, 404)
    assert.equal(digest(Buffer.from(await (await fetch(`${lab.base}/sw.js`)).arrayBuffer())), 'fd95bcb0ac27ebd032d3afd1f76379a6b8361b7d0ec4ef3046a55aa8b83b251a')
    const protectedPage = await naturalPage.goto(`${lab.base}/database-recovery`)
    assert(!(await protectedPage.text()).includes('src="/registerSW.js"'))
    const protectedAPI = await fetch(`${lab.base}/api/admin/database-recovery/status`)
    assert.equal(protectedAPI.status, 401)
    await lab.restartMode(false)
    assert.equal(digest(Buffer.from(await (await fetch(`${lab.base}/sw.js`)).arrayBuffer())), digest(filesC.get('dist/sw.js')))
    await naturalPage.goto(lab.base + recoveryPath)
    await naturalPage.locator('#update').click()
    await expect(naturalPage.locator('#status')).toContainText('已完成：', { timeout: 55000 })
    await naturalPage.locator('#home').click()
    await naturalPage.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    record('genuine restricted startup', { themeRecoveryDeniedForGuestAndAdmin: true, officialWorkerRetained: true, registrationTagStripped: true, unauthenticatedRecoveryApiDenied: true, returnedNormalWorkerMatchesCandidate: true })
    await natural.close()
    report.complete = true
    record('matrix complete', { complete: true })
  }
  catch (error) {
    report.outstandingRequests = [...outstanding.values()]
    report.workerStates = []
    for (const context of browser?.contexts() || []) {
      for (const page of context.pages()) {
        if (new URL(page.url()).pathname === recoveryPath) {
          report.workerStates.push(await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration('/')
            return { active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state, controlledByActive: navigator.serviceWorker.controller === registration?.active, status: document.getElementById('status')?.textContent }
          }))
        }
      }
    }
    record('failure', { message: String(error) })
    throw error
  }
  finally {
    await browser?.close()
    await lab.stop()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
