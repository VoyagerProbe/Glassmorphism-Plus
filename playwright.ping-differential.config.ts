import { defineConfig } from '@playwright/test'

// Independent release gate; never download a moving baseline or accept snapshots.
export default defineConfig({
  testDir: './tests/differential',
  outputDir: 'test-results/ping-release-differential',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 100_000,
  use: { baseURL: 'http://127.0.0.1:4173', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
})
