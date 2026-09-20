/* Glassmorphism Plus online compatibility worker: plus-online-v1.
 * Stable /sw.js is a delivery contract. No fetch interception or new caches.
 * Root scope also retires the official frontend/admin offline shell.
 */
const compatibilityId = 'plus-online-v1'
const legacyRevision = '01deecf312fd6fdfacc090ce81267cba'
const knownPlusShells = new Set([
  '442422019562099f6c7200fa42882823278afaaaa45882b263b00469ba649d47',
  'c809d20b628fae18e97675262dba96544d6736bde8936806c0ece047c211d3f4',
])
let legacyShell = 'not-checked'

// The official-theme roundtrip reuses this one fixed revision. Only the exact
// historical Plus HTML bytes may be invalidated; every other cache entry stays.
async function invalidateProvenLegacyShell() {
  const scope = globalThis.registration.scope
  if (scope !== `${globalThis.location.origin}/` || globalThis.location.pathname !== '/sw.js')
    return 'unsupported-scope'
  const name = `workbox-precache-v2-${scope}`
  if (!await caches.has(name))
    return 'absent'
  const cache = await caches.open(name)
  const target = `${scope}index.html?__WB_REVISION__=${legacyRevision}`
  const request = (await cache.keys()).find(request => request.url === target)
  if (!request)
    return 'absent'
  const response = await cache.match(request)
  if (!response || response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/html'))
    return 'unrecognized-retained'
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== 3816)
    return 'unrecognized-retained'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (!knownPlusShells.has(hash))
    return 'unrecognized-retained'
  return await cache.delete(request) ? 'exact-legacy-html-removed' : 'unrecognized-retained'
}

globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.skipWaiting())
})

globalThis.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      legacyShell = await invalidateProvenLegacyShell()
    }
    catch {
      // Storage denial must not prevent retiring the old fetch handler.
      legacyShell = 'unavailable-retained'
    }
    await globalThis.clients.claim()
  })())
})

globalThis.addEventListener('message', (event) => {
  if (event.data !== 'PLUS_COMPAT_STATUS_V1' || !event.ports[0] || !event.source?.url)
    return
  const source = new URL(event.source.url)
  if (source.origin !== globalThis.location.origin || !['/', '/themes/glassmorphism-plus/dist/plus-recovery.html'].includes(source.pathname))
    return
  event.ports[0].postMessage({ compatibilityId, mode: 'online-no-fetch', legacyShell })
})
