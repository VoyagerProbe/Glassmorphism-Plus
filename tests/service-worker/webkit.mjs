import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { webkit } from 'playwright'
import { createLab, makeZip } from './lab.mjs'
import { candidateFiles, naturalUpgrade } from './migration.mjs'

async function main() {
  const lab = await createLab()
  let browser
  const result = { physicalSafari: false, engine: 'Playwright WebKit', realMigration: false }
  try {
    browser = await webkit.launch()
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    const page = await context.newPage()
    await lab.upload(await lab.archive('A'))
    await lab.setTheme('glassmorphism-plus')
    await page.goto(`${lab.base}/admin`)
    result.capability = await page.evaluate(() => ({ secure: isSecureContext, swApi: Boolean(navigator.serviceWorker), register: typeof navigator.serviceWorker?.register }))
    if (result.capability.swApi) {
      await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.active?.state === 'activated' && navigator.serviceWorker.controller)), { timeout: 60000 }).toBe(true)
      const old = await page.goto(lab.base)
      assert((await old.text()).includes('index-v5LVT8Hh.js'))
    }
    else {
      result.limitation = 'This Playwright WebKit build exposes no Service Worker API; it cannot validate an original Safari profile migration.'
    }
    await lab.upload(await makeZip(candidateFiles(), resolve(lab.root, 'webkit-C.zip')))
    if (result.capability.swApi) {
      await naturalUpgrade(page)
      result.realMigration = true
      result.manualUpdateCalled = false
      result.recoveryPageVisited = false
    }
    else {
      await page.goto(lab.base)
    }
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert(!(await page.content()).includes('index-v5LVT8Hh.js'))
    await expect(page.locator('#plus-startup-help')).toHaveCount(0)
    const again = await page.reload()
    assert.equal(again.fromServiceWorker(), false)
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    result.naturalMigrationAndCurrentUi = true
  }
  finally {
    writeFileSync(resolve(lab.root, 'webkit-compat.json'), JSON.stringify(result, null, 2))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    await browser?.close()
    await lab.stop()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
