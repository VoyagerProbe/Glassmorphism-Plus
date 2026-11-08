import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const projects = ['webkit-desktop', 'webkit-iphone']
const root = process.argv[2]
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const counts = {}
const cases = new Map()

function collect(report, project, executed) {
  const ids = new Set()
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        assert.equal(test.projectName, project)
        // Playwright's spec id includes the full describe path, not just the title.
        assert(spec.id && !ids.has(spec.id), `Duplicate test: ${spec.title}`)
        ids.add(spec.id)
        if (executed) {
          assert.equal(test.status, 'expected', spec.title)
          assert.equal(test.results.length, 1, spec.title)
          assert.equal(test.results[0].status, 'passed', spec.title)
          assert.equal(test.results[0].retry, 0, spec.title)
          if (spec.title.startsWith('thirty-node palette editing')) {
            const evidence = test.results[0].attachments.find(a => a.name === 'palette-30-node-budget')
            const stress = JSON.parse(Buffer.from(evidence.body, 'base64').toString('utf8'))
            assert.equal(stress.cycles, 8)
            assert.equal(stress.colorInputs, 24)
            assert.equal(stress.additionalMonitoringRequestsDuringEditing, 0)
            assert.equal(stress.additionalIntervals, 0)
            assert.equal(stress.existingPollContinuesAfterClockAdvance, true)
          }
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  visit(report)
  return ids
}

for (const project of projects) {
  const dir = join(root, `webkit-palette-lane-${project}`)
  const planned = collect(read(join(dir, 'list.json')), project, false)
  const report = read(join(dir, 'results.json'))
  assert.deepEqual(report.errors, [])
  assert(report.config.argv.includes('--retries=0'))
  const actual = collect(report, project, true)
  assert.deepEqual(actual, planned)
  assert(actual.size >= 62, 'Do not silently reduce the existing per-project palette coverage')
  assert.deepEqual([report.stats.expected, report.stats.skipped, report.stats.flaky, report.stats.unexpected], [actual.size, 0, 0, 0])
  cases.set(project, actual)
  counts[project] = actual.size
}
assert.equal(cases.size, 2)
const summary = { projects: counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0), skipped: 0, flaky: 0, unexpected: 0, retries: 0 }
writeFileSync(join(root, 'webkit-palette-summary.json'), JSON.stringify(summary, null, 2))
process.stdout.write(`${JSON.stringify(summary)}\n`)
