import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { verifyInstallerZip } from './prepare-release'
import { getReleasePaths } from './release-paths'

const project = resolve(fileURLToPath(new URL('..', import.meta.url)))
const archiver = createRequire(import.meta.url)('archiver')
const temporary = mkdtempSync(resolve(tmpdir(), 'plus-installer-license-'))
const license = readFileSync(resolve(project, 'LICENSE'))
const changedLicense = Buffer.from(license)
changedLicense[0] ^= 1
const preview = readFileSync(resolve(project, 'docs/preview.png'))
const manifest = Buffer.from(JSON.stringify({ version: '0.0.0', short: 'license-fixture', preview: 'preview.png' }))
const scenarios = [
  { name: 'valid', failure: null },
  { name: 'missing-license', failure: /entry set does not match canonical inputs \(missing: LICENSE\)/ },
  { name: 'changed-license', failure: /SHA-256 provenance mismatch for LICENSE/ },
  { name: 'duplicate-license', failure: /duplicate entry: LICENSE/ },
  { name: 'missing-source-license', failure: /Source license does not exist/ },
]

try {
  for (const scenario of scenarios) {
    const fixture = resolve(temporary, scenario.name)
    mkdirSync(resolve(fixture, 'docs'), { recursive: true })
    mkdirSync(resolve(fixture, 'dist'))
    writeFileSync(resolve(fixture, 'komari-theme.json'), manifest)
    writeFileSync(resolve(fixture, 'docs/preview.png'), preview)
    writeFileSync(resolve(fixture, 'dist/index.html'), '<!doctype html><title>合成打包测试</title>')
    if (scenario.name !== 'missing-source-license')
      writeFileSync(resolve(fixture, 'LICENSE'), license)

    const installer = resolve(fixture, 'synthetic.zip')
    const output = createWriteStream(installer, { flags: 'wx' })
    const archive = archiver('zip', { zlib: { level: 1 } })
    const complete = new Promise<void>((done, fail) => {
      output.on('close', done)
      output.on('error', fail)
      archive.on('error', fail)
    })
    archive.pipe(output)
    archive.append(manifest, { name: 'komari-theme.json' })
    archive.append(preview, { name: 'preview.png' })
    archive.file(resolve(fixture, 'dist/index.html'), { name: 'dist/index.html' })
    if (scenario.name !== 'missing-license') {
      archive.append(scenario.name === 'changed-license' ? changedLicense : license, { name: 'LICENSE' })
    }
    if (scenario.name === 'duplicate-license')
      archive.append(license, { name: 'LICENSE' })
    await archive.finalize()
    await complete

    if (scenario.failure)
      assert.throws(() => verifyInstallerZip(installer, '0.0.0', fixture), scenario.failure)
    else
      assert.equal(verifyInstallerZip(installer, '0.0.0', fixture).fileCount, 4)
    console.log(`通过：${scenario.name}`)
  }
}
finally {
  // 只清理本脚本创建的临时夹具，绝不触及真实安装包或发布目录。
  assert.equal(dirname(temporary), resolve(tmpdir()))
  assert(temporary.startsWith(resolve(tmpdir(), 'plus-installer-license-')))
  rmSync(temporary, { recursive: true })
}

if (process.argv.includes('--built')) {
  const version = JSON.parse(readFileSync(resolve(project, 'komari-theme.json'), 'utf8')).version
  const verified = verifyInstallerZip(getReleasePaths(project, version).installerPath, version, project)
  console.log(`实际构建安装包通过：${verified.fileCount} 个文件；LICENSE 与源码逐字节一致`)
}
