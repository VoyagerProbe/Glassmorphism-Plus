import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Native Node runner: the project does not depend on Vitest.
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import vm from 'node:vm'
import { project } from './lab.mjs'

const code = readFileSync(resolve(project, 'public/sw.js'), 'utf8')
const origin = 'https://synthetic.invalid'
const scope = `${origin}/`
const key = `${origin}/index.html?__WB_REVISION__=01deecf312fd6fdfacc090ce81267cba`

function fixture({ stored = '', url = key, name = `workbox-precache-v2-${scope}`, denied = false, scopeURL = scope } = {}) {
  const handlers = {}
  const calls = []
  const worker = {
    URL,
    Set,
    Uint8Array,
    crypto: webcrypto,
    location: new URL(`${origin}/sw.js`),
    registration: { scope: scopeURL },
    skipWaiting: async () => { calls.push('skipWaiting') },
    clients: { claim: async () => { calls.push('claim') } },
    addEventListener: (type, handler) => { handlers[type] = handler },
    caches: {
      has: async actual => actual === name,
      open: async () => {
        if (denied)
          throw new Error('synthetic storage denial')
        return {
          keys: async () => [new Request(url)],
          match: async () => new Response(stored, { headers: { 'Content-Type': 'text/html' } }),
          delete: async (request) => {
            calls.push(`delete:${request.url}`)
            return true
          },
        }
      },
    },
  }
  vm.runInNewContext(code, worker, { timeout: 1000 })
  async function lifecycle(type) {
    let lifetime
    handlers[type]({ waitUntil: (promise) => {
      lifetime = promise
    } })
    assert(lifetime && typeof lifetime.then === 'function')
    await lifetime
  }
  return { handlers, calls, lifecycle }
}

it('worker has only install, activate and fixed diagnostics, never fetch interception', async () => {
  const worker = fixture()
  assert.deepEqual(Object.keys(worker.handlers).sort(), ['activate', 'install', 'message'])
  await worker.lifecycle('install')
  await worker.lifecycle('activate')
  assert.deepEqual(worker.calls, ['skipWaiting', 'claim'])
})

it('unknown HTML, wrong revision, lookalike namespace and different scope are retained', async () => {
  for (const options of [
    { stored: '<html>another application</html>' },
    { stored: 'x'.repeat(3816) },
    { url: `${origin}/index.html?__WB_REVISION__=different` },
    { name: `unrelated-workbox-precache-v2-${scope}` },
    { scopeURL: `${origin}/unrelated/` },
  ]) {
    const worker = fixture(options)
    await worker.lifecycle('activate')
    assert(!worker.calls.some(call => call.startsWith('delete:')))
  }
})

it('denied Cache Storage does not block online activation', async () => {
  const worker = fixture({ denied: true })
  await worker.lifecycle('activate')
  assert.deepEqual(worker.calls, ['claim'])
})

it('diagnostic cannot supply deletion targets, URLs or executable operations', async () => {
  const worker = fixture()
  const replies = []
  const valid = { data: 'PLUS_COMPAT_STATUS_V1', source: { url: `${origin}/` }, ports: [{ postMessage: data => replies.push(data) }] }
  worker.handlers.message({ ...valid, data: { action: 'delete', target: '*' } })
  worker.handlers.message({ ...valid, source: { url: 'https://other.invalid/' } })
  worker.handlers.message({ ...valid, source: { url: `${origin}/admin` } })
  assert.equal(replies.length, 0)
  worker.handlers.message(valid)
  assert.equal(replies.length, 1)
  assert.equal(replies[0].compatibilityId, 'plus-online-v1')
  assert.equal(replies[0].mode, 'online-no-fetch')
  assert.deepEqual(worker.calls, [])
})

it('manual recovery removal preserves the exact compatible worker and original bootstrap', () => {
  assert.equal(createHash('sha256').update(code).digest('hex'), '472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527')
  for (const name of ['plus-recovery.html', 'plus-recovery.js'])
    assert.equal(existsSync(resolve(project, 'public', name)), false)
  const html = readFileSync(resolve(project, 'index.html'), 'utf8')
  assert(!html.includes('plus-recovery') && !html.includes('plus-startup-help'))
  assert(!html.includes('serviceWorker') && !html.includes('caches.'))
  assert(html.includes('var officialAppRoute') && html.includes('catch (error)'))
  assert(html.includes('src="/src/main.ts"'))
})
