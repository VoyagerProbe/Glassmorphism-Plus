import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { inflateRawSync } from 'node:zlib'
import archiver from 'archiver'

export const project = resolve(import.meta.dirname, '../..')
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const delay = ms => new Promise(done => setTimeout(done, ms))
const labEnvironmentKeys = /^(?:PATH|SystemRoot|WINDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|COMSPEC)$/i

// Historical customer installers and the official binary stay outside the repo.
export const fixtures = {
  A: { url: 'https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.1/Glassmorphism-Plus-release-2.8.1.zip', sha: '72ee887c777bc54bab3ba6709944d600cd390478de28cab8ac52f89128ba27a4' },
  B: { url: 'https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.2/Glassmorphism-Plus-release-2.8.2.zip', sha: 'efd3b24217b6b9bed5cf3ed1784c278dde081c42e45619bc68af5b6d476dea0c' },
}

export async function download(url, file, expected) {
  if (!existsSync(file)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    assert.equal(response.status, 200, 'Fixture download failed')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(digest(bytes), expected, 'Unexpected fixture bytes')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  assert.equal(digest(readFileSync(file)), expected, 'Fixture hash changed')
  return file
}

// A bounded ZIP reader for hash-pinned synthetic/historical test artifacts only.
// No extraction paths or browser/auth state are written into the source tree.
export function zipFiles(path) {
  const zip = readFileSync(path)
  let end = zip.length - 22
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054B50) end--
  assert(end >= 0, 'ZIP directory required')
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014B50)
    const method = zip.readUInt16LE(offset + 10)
    const size = zip.readUInt32LE(offset + 20)
    const unpacked = zip.readUInt32LE(offset + 24)
    const length = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 46, offset + 46 + length).toString('utf8')
    assert(!name.startsWith('/') && !name.includes('\\') && !name.includes(':') && !name.split('/').includes('..'))
    assert(unpacked < 32 * 1024 * 1024)
    const local = zip.readUInt32LE(offset + 42)
    assert.equal(zip.readUInt32LE(local), 0x04034B50)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    if (!name.endsWith('/')) {
      assert(!files.has(name))
      assert(method === 0 || method === 8)
      const compressed = zip.subarray(start, start + size)
      const data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: unpacked })
      assert.equal(data.length, unpacked)
      files.set(name, data)
    }
    offset += 46 + length + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
  }
  return files
}

export async function makeZip(files, path) {
  const output = createWriteStream(path, { flags: 'wx' })
  const zip = archiver('zip', { zlib: { level: 6 } })
  const done = new Promise((ok, fail) => {
    output.on('close', ok)
    output.on('error', fail)
    zip.on('error', fail)
  })
  zip.pipe(output)
  for (const [name, bytes] of files) zip.append(bytes, { name })
  await zip.finalize()
  await done
  return path
}

export async function createLab() {
  const root = resolve(process.env.KOMARI_SW_LAB_ROOT || tmpdir(), `plus-sw-${Date.now()}-${randomBytes(4).toString('hex')}`)
  mkdirSync(root, { recursive: true })
  const downloads = resolve(process.env.KOMARI_SW_FIXTURES || tmpdir(), 'plus-sw-fixtures')
  const windows = process.platform === 'win32'
  const name = windows ? 'komari-windows-amd64.exe' : 'komari-linux-amd64'
  const expected = windows ? 'afe1277a5ae451807ba64c999515737e735bca5b39e9b9162d10d249c709e23c' : 'b82c0551577e70aa609121d90ed9e073b16f72ba597dd576e18297122dc9ef4c'
  const binary = await download(`https://github.com/komari-monitor/komari/releases/download/1.5.0-fix1/${name}`, resolve(downloads, name), expected)
  if (!windows)
    chmodSync(binary, 0o700)
  const { createServer } = await import('node:net')
  const server = createServer()
  const port = await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port
      server.close(() => ok(p))
    })
  })
  const base = `http://127.0.0.1:${port}`
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => labEnvironmentKeys.test(key)))
  const child = spawn(binary, ['server', '--listen', `127.0.0.1:${port}`, '--database', './data/komari.db'], { cwd: root, env, windowsHide: true, stdio: ['ignore', openSync(resolve(root, 'server.log'), 'a'), openSync(resolve(root, 'server-error.log'), 'a')] })
  let cookie = ''
  async function request(path, { body, auth = false, method = body === undefined ? 'GET' : 'POST', raw = false } = {}) {
    const headers = auth ? { Cookie: cookie } : {}
    if (body !== undefined && !(body instanceof FormData))
      headers['Content-Type'] = 'application/json'
    const r = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    assert(r.ok, `Lab request ${path.split('?')[0]} HTTP ${r.status}`)
    return raw ? r : r.json()
  }
  async function stop() {
    if (child.exitCode === null) {
      const exit = new Promise(ok => child.once('exit', ok))
      child.kill()
      await exit
    }
  }
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try {
        await request('/api/install/status')
        ready = true
        break
      }
      catch { await delay(200) }
    }
    assert(ready, 'Lab did not start')
    const username = 'synthetic-sw-lab'
    const password = `Lab1${randomBytes(24).toString('hex')}`
    await request('/api/install/complete', { body: { username, password, sitename: 'Synthetic SW Lab', description: 'Disposable service worker regression lab', metric_dsn: './data/metrics.db' } })
    await delay(1200)
    const login = await request('/api/login', { body: { username, password }, raw: true })
    cookie = login.headers.get('set-cookie').split(';')[0]
    async function upload(path) {
      const bytes = readFileSync(path)
      const init = await request('/api/admin/upload/init', { auth: true, body: { purpose: 'theme', size: bytes.length, filename: 'Glassmorphism-Plus.zip' } })
      for (let start = 0, i = 0; start < bytes.length; start += init.data.chunk_size, i++) {
        const form = new FormData()
        form.append('upload_id', init.data.upload_id)
        form.append('chunk_index', String(i))
        form.append('chunk_data', new Blob([bytes.subarray(start, start + init.data.chunk_size)]), 'chunk')
        await request('/api/admin/upload/chunk', { auth: true, body: form })
      }
      const result = await request('/api/admin/upload/merge', { auth: true, body: { upload_id: init.data.upload_id } })
      assert.equal(result.data.short, 'glassmorphism-plus')
      return { bytes: bytes.length, sha256: digest(bytes), short: result.data.short }
    }
    const setTheme = theme => request(`/api/admin/theme/set?theme=${encodeURIComponent(theme)}`, { auth: true })
    const archive = async (label) => {
      const f = fixtures[label]
      return download(f.url, resolve(downloads, `${label}-${f.sha}.zip`), f.sha)
    }
    return { root, base, request, upload, setTheme, archive, stop, credentials: { username, password }, cookie, binaryHash: expected }
  }
  catch (error) {
    await stop()
    throw error
  }
}
