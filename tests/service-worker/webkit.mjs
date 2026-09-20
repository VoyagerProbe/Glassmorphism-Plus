import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { webkit } from 'playwright'
import { createLab, makeZip } from './lab.mjs'
import { candidateFiles } from './migration.mjs'

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
    await page.goto(`${lab.base}/themes/glassmorphism-plus/dist/plus-recovery.html`)
    if (result.capability.swApi) {
      await page.locator('#update').click()
      await expect(page.locator('#status')).toContainText('已完成：', { timeout: 55000 })
      result.realMigration = true
    }
    else {
      await expect(page.locator('#update')).toBeDisabled()
      await expect(page.locator('#status')).toContainText('不支持此恢复操作')
    }
    await page.locator('#home').click()
    await page.waitForFunction(() => Boolean(document.querySelector('#app')?.__vue_app__))
    assert(!(await page.content()).includes('index-v5LVT8Hh.js'))
    result.recoveryAndCurrentUi = true
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
