# Glassmorphism Plus Codex Permanent Development Guide

This document is the permanent Codex operating manual for Glassmorphism Plus.

It is intentionally version-independent. Version-specific bugs, feature requests,
temporary experiments, release notes, validation output, and task handoff state
belong in the user task and `AICACHE.md`, not here.

## 1. Required reading and instruction model

Before non-trivial work, read:

1. root `AGENTS.md`;
2. this `CODEX.md`;
3. `AIAGENTREADME.md`;
4. `AICACHE.md`;
5. the nearest scoped `AGENTS.md`;
6. relevant documentation under `docs/`.

`AIAGENTREADME.md` owns detailed architecture and implementation explanations.
`AICACHE.md` owns temporary task progress, validation results, blockers, and
handoff context. This file owns durable Codex workflow, safety, product, release,
privacy, and Git rules.

Nested `AGENTS.md` files may add scoped implementation guidance, but they must
not intentionally weaken repository-wide safety, privacy, Git, version, release,
or product invariants defined here.

## 2. Project identity

Glassmorphism Plus is a customized Komari Monitor theme based on the original
Glassmorphism theme by sanrokamlan.

The project uses Vue 3, Vite, TypeScript, Bun, Tailwind-based project styling, and
Playwright regression/visual testing. Its production artifact is a
Komari-importable theme ZIP; it is not a generic standalone web deployment.

Protected project identity:

- Product: Komari Glassmorphism Plus
- Maintainer: VoyagerProbe
- Repository: `https://github.com/VoyagerProbe/Glassmorphism-Plus`
- Upstream author: sanrokamlan
- Upstream repository: `https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism`

Do not accidentally restore upstream branding or repository identity during
upstream synchronization.

## 3. Canonical source and reference directories

The only formal development source is `komari-theme-Glassmorphism-main`. All
code, UI, configuration, version changes, tests, builds, and release preparation
begin there.

Never continue normal development directly inside:

- `Glassmorphism-Plus-publish-<version>`;
- `Glassmorphism-Plus-release-<version>`.

Those are snapshots/artifacts only. If release validation exposes a bug, return to
the canonical source, fix it there, rerun validation, and regenerate affected
artifacts.

The following are read-only reference directories by default:

- `_upstream-komari-glassmorphism-reference` — upstream tag/commit/diff research;
- `komari-main` — Komari API, backend, and data-model research;
- `Komari-Theme-LuminaPlus-main` — reference-theme research.

Never copy, commit, build, or push LuminaPlus content as Glassmorphism Plus
source.

## 4. Task authorization modes

Classify the user request before acting.

### Review, analysis, or diagnosis

Examples: inspect, analyze, compare, review, explain, or locate the cause.

Allowed work includes reading files, inspecting Git, and safe diagnostics. Do not
edit production source, bump versions, commit, push, or publish unless the user
explicitly requests implementation or release work.

### Implementation, fix, or feature

Examples: fix, implement, optimize, modify, or add a feature.

Edit only in-scope canonical source. Follow §11: deliver the local candidate before running validation. Implementation is not authorization to publish.

### Formal release

Publication requires the candidate-specific authorization and all gates in §11. A version number or earlier release request does not bypass the trial.

## 5. Start-of-task workflow

Before broad edits:

1. confirm the working directory;
2. read the active instruction files;
3. inspect `git status`;
4. inspect relevant Git history when needed;
5. identify the affected architecture/data path;
6. identify unrelated pre-existing changes;
7. preserve user work.

For long, multi-file, interruptible, architecture, security, or release work,
maintain `AICACHE.md`. Never store secrets, tokens, cookies, credentials, private
server access, or private keys there.

## 6. Architecture boundary

New application code follows this boundary:

```text
Component
  -> Composable
  -> Service
  -> RequestManager / CacheService
  -> API / RPC
```

- Components own UI rendering and orchestration.
- Composables own Vue reactive state and lifecycle.
- Services own business and infrastructure behavior.
- Stores own application-level normalized state.
- `src/constants/` owns shared limits/settings.
- `src/utils/` owns pure/general helpers.
- Existing API/RPC utilities own low-level transport.

Do not add direct business RPC workflows inside components when the service layer
should own them. Do not create ad-hoc component-local caches for shared business
data. Do not parse raw `theme_settings` in UI components; normalize it through the
appropriate store/service path.

## 7. Existing work and destructive-Git protection

Never silently discard pre-existing user changes. When the working tree is dirty:

1. inspect the changes;
2. determine whether they belong to the current task;
3. preserve unrelated work;
4. report ambiguity before any destructive action.

Without explicit authorization, do not use destructive or history-rewriting
operations, including `git reset --hard`, `git clean -fd`, destructive restore or
checkout of unrelated work, branch/tag deletion, published-history rewriting,
force-push, or moving published tags.

Never solve a merge by replacing the current Plus tree with another source tree.

## 8. Dependency policy

Reuse installed dependencies when they match the repository lockfile. Only when
missing or inconsistent, run `bun install --frozen-lockfile` once.

Do not automatically run `bun update` or `npm update`. Use them only when the
user explicitly requests it, an intentional upstream change requires it, or a
confirmed implementation need makes it necessary.

Do not add a production dependency when the existing stack can reasonably solve
the task. Justify every new production dependency in the final report.

## 9. Standard commands

Run commands from the repository root. `package.json` is the authority for scripts.
Stage 1 uses only the inspected production compilation/packaging part (currently `bun run build-only`); the normal commands below are for their authorized stage, not a startup checklist:

```bash
bun run dev
bun run type-check
bun run lint
bun run build
bun run test:visual
bun run test:visual:update
bun run release:prepare
bun run preview
```

`bun run build` includes type-checking: one successful build covers both gates.
Do not repeat type-check or rebuild unchanged inputs. `bun run test:visual`
builds again; use the installed Playwright CLI to reuse validated dist when safe.
Use installed ESLint on changed files without automatic unrelated fixes; the
project lint script includes `--fix`, so scope it and review the resulting diff.
In Stage 2 run the complete applicable suite, including the configured browsers; targeted diagnostics do not replace full gates. Report unrun suites as unrun.

Do not invent `bun test`, Vitest, or another test framework unless it actually
exists in the repository. Never claim an unexecuted command passed.

`bun run publish` is a state-mutating version/release preparation command. It may
write project version metadata and create a release workspace. Never run it,
`bun run release:prepare`, or a release workflow for ordinary implementation or
documentation work; each requires explicit release/version authorization.

## 10. Test integrity

Tests detect regressions; they are not obstacles to bypass. Never make tests green
by deleting relevant tests, unjustified skipping, weakening assertions merely to
accept incorrect behavior, turning failures into warnings, blindly updating visual
snapshots, or fabricating unrealistic fixtures that avoid the failure.

When tests fail, determine whether the cause is implementation, stale expectation,
unrealistic fixture, or environment. Visual snapshots may change only when the
product change truly requires it. Update only directly affected snapshots and
document why.

## 11. Two-stage candidate, validation and publication policy

This is the single authoritative workflow for this and future product revisions, unless the user explicitly changes it. It supersedes historical test-before-handoff and default Pre-release instructions. The commands and quality gates elsewhere in this repository describe **what** to validate, not permission to run them early.

### Stage 1 — local candidate; stop for user installation

1. Preserve existing work, Git references and same-version ZIPs. Start at the user-approved, verified local source baseline. Edit only the requested product and rule files. No GitHub access (including fetch/pull, API reads, push, PR, tags, Release, workflows or market operations).
2. Inspect real scripts and their hooks. Review source and identity; use only the necessary production bundler with the approved lockfile. Isolate its versioned output so it cannot overwrite an older installer. Do not run browsers, Playwright, screenshots, smoke, unit/integration tests, lint, independent type-check, full validation, or release preparation in this stage. Do not weaken the normal build, test suite or CI.
3. Deliver the real installer in a new, never-overwritten `<version>/local-candidate-YYYYMMDD-NN/` directory. Record source commit (or dirty inputs), filename, size, full SHA-256, safe archive structure, privacy scan and what was **not** tested. README/changelog changes remain unpublished drafts. Stop. Local compilation and archive inspection are not functional verification.

### Stage 2 — explicit approval of a specific candidate

1. Confirm the user's successful trial and explicit scope of approval against candidate number, filename, source and ZIP SHA-256 (`H_APPROVED`). Silence, approval of an older build, or feedback asking for changes is not approval. Test-only permission stops before remote publication.
2. Run all applicable real gates: lint, type-check, complete build, unit/integration suites where present, the configured browsers and visual regressions, Tooltip, palette permissions/save, Worker, isolated Komari installation and final privacy review. Use a separate verification output; do not overwrite the approved ZIP. Preserve data assertions, thresholds and required coverage; report missing environments honestly.
3. A fixture/test-only correction with unchanged production inputs and ZIP requires the affected and complete applicable validation, not new installer bytes. Any change to product inputs, manifest, layout or packaged payload stops publication: return to Stage 1 with a new numbered ZIP and obtain new trial approval. Fix any privacy issue before public action.
4. With publication authorized and local gates passed, check live account, repo, main, complete tags/releases/assets, concurrent changes, protection and market references. Safely integrate source and docs, use a normal non-force push, and wait for every applicable remote quality/security check on the final commit. Verify final tag/source provenance, documenting any docs/test-only differences from the approved product inputs.
5. Publish directly as **Stable / Latest** (title = tag, draft=false, prerelease=false), not an intermediate Pre-release. Use the exact approved original ZIP as the sole customer asset. Do not rebuild to change its status. Re-download outside the source tree; require `H_DOWNLOAD == H_APPROVED`, equal size, safe extraction, manifest and runtime resources. Reconcile README, changelog and Release with the actual result; docs-only closeout does not move the production tag.
6. If the name already exists, stop before changing anything: inventory the peeled tag, Release target/status, assets, hashes and market references. Replacing a different draft/Pre-release or moving a tag requires separate, object-specific approval and backup. No overwrite, deletion, downgrade or bypass of Stable/Latest, immutable/protected tags or assets; do not invent a different version. The market uses the existing short; no submission on the user's behalf.

A build, a handoff, Git operations and a completed public release are distinct outcomes; record only what actually happened.

## 12. Version source of truth

`komari-theme.json.version` is the formal release-version source of truth. If
`package.json` has a top-level `version`, it is mirrored metadata and must match.

For a version bump, inspect genuine current-version locations such as:

- `komari-theme.json`;
- `package.json`;
- root lockfile project metadata, if present;
- footer/build metadata;
- README current-version text;
- manifest/build tests;
- release metadata.

The shared footer version attribution line is `v<current manifest version> ·
VoyagerProbe`, using the existing build variable. Keep upstream attribution in
repository documentation and preserve LICENSE.

Do not blindly replace version-looking values in historical changelog entries,
old release notes, upstream/Komari versions, dependency versions, schema/cache
versions, or fixture/business data. After a bump, search for the previous current
version and classify every remaining occurrence.

## 13. Versioned release paths

For Stage 2 formal publication only, the established paths are (Stage 1 uses the isolated candidate directories in §11):

```text
<source-parent>/<version>/Glassmorphism-Plus-publish-<version>/
<source-parent>/<version>/Glassmorphism-Plus-release-<version>/
<source-parent>/<version>/Glassmorphism-Plus-release-<version>.zip
```

`bun run build` must produce valid installer inputs and the versioned installer.
`bun run release:prepare` verifies that installer and creates the filtered release
snapshot. A publish clone must be created separately from the approved repository
so that valid Git history is retained.

Do not rename `komari-theme.json`, `docs/preview.png`, or established release-path
logic without auditing all related build/release scripts.

## 14. Final customer installer ZIP

Do not broadly prohibit ZIP files. Development/testing/upstream ZIPs may be used
when appropriate.

The final customer installer is normally:

```text
Glassmorphism-Plus-release-<version>.zip
```

It is required locally for formal-release verification. Its root must directly
contain:

```text
komari-theme.json
preview.png
LICENSE
dist/
```

It must not contain a wrapper source directory, `src/`, `tests/`, `.git/`,
`node_modules/`, `.env`, HAR, browser profiles, storage/auth exports, or debug
artifacts.

The final customer installer always remains outside Git: never stage, commit, or
push it to `main`. For a formal GitHub Release, upload that exact locally verified
ZIP by default as the Release's only custom asset unless the user explicitly opts
out for that version. Before upload, record its SHA-256 and verify its structure,
manifest version, privacy scan, tag target, and `main` target. Never upload publish
directories, release snapshots, test/debug artifacts, or alternate ZIPs.

After upload, download the asset into a temporary directory outside every source,
publish, and release tree. Verify the downloaded SHA-256 exactly matches the local
installer, confirm it extracts safely, recheck the manifest version/root contract,
and then safely clean the temporary copy. If a same-name asset already exists,
compare content first: keep an identical asset, but do not use clobber, delete, or
replace a differing public asset without stopping for user direction.

## 15. Artifact provenance

A formal release has one authoritative final source state. GitHub `main`, the
final commit, release tag when used, publish clone, release snapshot, customer
installer ZIP, and installer manifest version must all correspond to that state.

Keep the original approved candidate ZIP. Document any later docs/test-only differences. Changed production inputs or installer payload require a new numbered candidate and user trial under §11; the formal tag must target the verified final commit.

## 16. Published-release immutability

Do not silently rewrite an already published formal version. After public release,
do not move the published tag, rewrite its history, silently replace it with
incompatible code, or present a changed artifact as the same immutable release.

For a same-version conflict follow §11: never overwrite a Stable/Latest or protected release or choose a replacement version unilaterally.

## 17. Formal GitHub policy

The formal repository is:

```text
https://github.com/VoyagerProbe/Glassmorphism-Plus
```

The formal branch is `main`. Only in authorized Stage 2, before publication, run and
inspect:

```bash
git status
git diff
git diff --cached
git remote -v
git branch --show-current
git log --oneline -10
```

Stop and report if the remote or branch is not the intended target. Never
accidentally push to sanrokamlan upstream, `komari-monitor`, LuminaPlus, or the
upstream reference.

Use normal non-force `git push origin main`; this policy never authorizes a force-push to `main`. GitHub `main` must contain
complete maintainable source, not a dist-only, release-only, installer-only, or
local-debug repository.

When GitHub Releases are used, verify the tag, target commit, release status, and
assets. Unless the user explicitly opts out for that version, the completed
Release must contain exactly one custom asset: the verified final customer
installer ZIP. GitHub-generated source archives are not custom assets.

### GitHub Release metadata contract

Before creating or maintaining Releases, query the repository's complete current
Release metadata with pagination. Treat GitHub's current values as authoritative;
do not restore titles, notes, status, targets, or assets from an old README,
template, report, screenshot, cache, or local backup.

For every future formal Release:

- use the publication state and same-name conflict gates in §11;
- use the full SemVer tag `v<version>`;
- set the Release title/name to exactly the tag (`release.name === release.tag_name`)
  without a product-name or `Release` prefix;
- write the body in Simplified Chinese, preserve real Markdown line breaks, never
  emit a literal `\n`, and include a `完整变更记录` link comparing the real previous
  tag with the current tag;
- describe only verified work from that version and preserve exact hotfix,
  installer-name, project-name, version, and technical-boundary facts;
- preserve current `Latest`, pre-release, draft, target, tag, publication, asset,
  and user-edited body state unless the task explicitly authorizes that exact
  change.

When maintaining existing Releases, back up the complete current metadata outside
the repository before any write. Change only the authorized fields, then reread
all Releases and compare protected fields and every asset ID, name, size, digest,
and URL against the backup. Draft Releases remain private and must not be published,
deleted, or added to the public README merely as part of metadata maintenance.

### README release-maintenance contract

Every formal release must also reconcile the root README against the complete live
GitHub Release inventory. The release is not complete until all of the following
are true:

1. the current Plus version, source-release reference, installer filename, and
   single expanded `最新版本 · v<version>` section identify the released version;
2. the latest summary is a concise subset of the current GitHub Release body, not
   newly invented release content;
3. the previous latest entry is moved into the collapsed version history;
4. every public non-draft Release is represented exactly once and no nonexistent
   version is invented;
5. history is sorted from newest to oldest by SemVer, with any historical non-`v`
   tag retained exactly as it exists;
6. `（预发布）` is shown only when the current GitHub metadata reports
   `prerelease = true`, while drafts are omitted;
7. the `<details>` structure is complete and renders correctly on GitHub;
8. older history and manually revised current content are preserved rather than
   overwritten from stale templates.

## 18. Mandatory privacy and staged-file review

Before every formal commit, push, or Release, inspect actual candidate/staged files
for accidental sensitive or local material, including:

- `.env` and `.env.local`;
- tokens, API keys, Authorization headers, passwords, secrets, Telegram tokens;
- cookies, sessions, browser exports, private keys, SSH/TLS keys, certificates;
- databases, logs, HAR, Playwright `storageState`, auth state, browser profiles,
  Cache Storage/IndexedDB exports, traces, test results, screenshots, debug output,
  temporary files, `node_modules`, unintended `dist`, unintended installers, and
  `AICACHE.md`;
- real local absolute user-profile paths.

Never commit browser debugging/authentication state. Normal public metadata is not
a secret merely because it contains `VoyagerProbe`, `sanrokamlan`, public
GitHub URLs, LICENSE text, public RPC method names, test UUIDs, or fixture data.

Keep `.gitignore` narrowly protective: do not broadly ignore legitimate tracked
runtime images or intentional visual fixtures.

## 19. Upstream synchronization

Only perform upstream synchronization when the user explicitly requests it. Use
`_upstream-komari-glassmorphism-reference` as the comparison source.

Process:

1. fetch the needed upstream tags/commits;
2. identify the old baseline and target;
3. generate actual diffs;
4. classify changes;
5. selectively merge into canonical Plus source;
6. preserve protected Plus behavior;
7. document conflicts;
8. test merged behavior.

Never overwrite Plus with upstream wholesale. Resolve conflicts as upstream, Plus,
or hybrid; Plus behavior wins where direct upstream adoption would remove an
intentional Plus capability. Do not restore upstream branding/repository identity
because upstream metadata changed.

## 20. Protected Glassmorphism Plus behavior

Future fixes and upstream syncs must preserve intentional Plus capabilities unless
the user explicitly requests a redesign. Protected capabilities include:

- per-node Ping task binding and `pingsettings`;
- `task.clients` validation and Ping task-name display;
- selected-task Metric behavior and same-task legacy fallback;
- correct 100% packet-loss semantics and invalid-binding fallback;
- Ping cache identity isolation and Promise dedupe;
- automatic refresh cleanup, fixed history buckets, and stale-while-revalidate;
- pending/data/confirmed-missing states and late real-sample backfill;
- canonical Ping ordering and Cold Start/Warm Start correctness;
- dark/light UI, Glassmorphism Plus identity, and administrative functionality;
- public monitoring home/detail access;
- browser `document.title` following the Komari site name.

Upstream repairs must be absorbed without unintentionally reverting these
behaviors.

## 21. Ping/history reliability invariants

Never fabricate monitoring history. Forbidden behavior includes copying prior
latency/loss into a newer timestamp, converting `null` to `0`, artificial
interpolation, fake sample timestamps, mixing different selected tasks, or
disguising selected-task failure with aggregate data.

For a valid selected task, failure is valid monitoring information: latency can be
unavailable, loss can be 100%, and a target can be offline. These do not
automatically invalidate a task binding. Only binding invalidity may trigger
invalid-binding fallback.

Preserve confirmed missing buckets and allow later genuine samples to backfill
them. Share raw cache/data semantics between NodeCard and Detail where practical;
use keyed request dedupe, bounded sample-aware retries, cleanup, and an explicit
missing-decision deadline. Avoid permanent per-card high-frequency timers.

Browser cache may improve speed but must never be required for correctness. Cold
Start and Warm Start must converge to the same monitoring semantics.

## 22. UI and source safeguards

Use the established stack:

- Vue Composition API and `<script setup lang="ts">`;
- Tailwind/project tokens;
- reka-ui/local primitives;
- `@iconify/vue`.

Do not introduce Naive UI, UnoCSS, SCSS, `lucide-vue-next`, or another component
framework without explicit need and authorization. The only established app global
is `window.$message`.

Keep public home/detail routes public. Gate sensitive actions/data using established
authentication services and `appStore.requireLoginPermission()` rather than broad
router guards. Do not parse raw `theme_settings` directly in components.

Keep `nodeCardSize` default as `compact`; `mini` is optional and must not replace
compact behavior. Runtime files under `public/images/` are compatibility
contracts—audit helper mappings before renaming them. Route views must retain the
single root structure required by `Transition`/`KeepAlive`; after route-root or
lifecycle changes, browser-test home -> detail -> home.

## 23. Generated-file safeguards

Do not hand-edit generated or minified artifacts when authoritative source exists.
This especially applies to `public/admin-app` unless all of the following are true:

1. the task explicitly requires admin-app work;
2. the authoritative source/build/sync path is identified;
3. rebuilding/synchronizing is the deliberate approved solution.

Do not treat generated output as source of truth.

## 24. Release completion gate

Do not declare a formal release complete merely because code compiles, the build
succeeds, or an installer ZIP exists. Applicable completion gates include:

- matched candidate trial and Stage 2 publication authorization recorded (§11);
- requested implementation complete and all applicable regressions pass;
- type-check, lint, and build pass;
- relevant Playwright/browser regression pass;
- privacy scan and staged-diff review complete;
- version consistency and artifact provenance verified;
- Git remote/branch verified;
- approved source committed and pushed;
- GitHub `main` verified;
- release tag/status verified when used;
- customer installer verified locally, kept outside Git, uploaded by default as
  the sole custom Release asset unless explicitly opted out, then downloaded and
  reverified outside the repository before temporary cleanup.

If a required gate cannot be completed, report the task as blocked or partially
verified rather than fully complete.

## 25. Concise formal release report

Summarize completed changes, actual causes and fix locations; executed validation
and intentionally unrun checks; privacy/identity/copyright review; final commit,
Release URL, installer name/size/SHA-256 and downloaded parity; remaining limits.
Keep detailed file lists, logs, command output and provenance evidence locally.
Do not repeat an exhaustive historical matrix or claim unexecuted verification.

## 26. Permanent-rule maintenance

This file is intentionally version-independent. Do not add ordinary version-specific
bug descriptions, temporary plans, one-off debugging notes, or release notes here.
They belong in the user task, `AICACHE.md`, or release notes/changelog.

Update `CODEX.md` only when durable policy changes, such as repository identity,
permanent development workflow, release policy, Git policy, privacy/security rules,
architecture invariants, or repeated failures revealing a missing guardrail. Keep
this file reusable across future Glassmorphism Plus versions.
