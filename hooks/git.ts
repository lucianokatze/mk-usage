// Pure logic of the git and GitHub row: what git and gh print, read into
// values; the tone of each state; the row that fits a width; the detail. No
// `$` here, so tests reach every function directly. Every word comes from
// `Words.git` and every setting from `GitPrefs`.

import type { Check, GitFiles, GitHubState, GitOperation, GitState, PullRequest } from '../types'
import { MINUTE, duration, textOf } from './usage'
import type { Row, Segment, Style, Tone } from './usage'
import type { GitWords } from './words'

// ---------------------------------------------------------------- preferences

export type CommitStyle = 'conventional' | 'plain'
export type CommitVia = 'auto' | 'bash' | 'direct'

/** The person's git options (the manifest's `git_*`), each checked and defaulted. */
export type GitPrefs = {
  refreshMs: number
  github: boolean
  githubEveryMs: number
  /** The changelog whose staleness the row warns of; null turns the warning off. */
  changelogFile: string | null
  tagPattern: string
  commitStyle: CommitStyle
  commitAi: boolean
  commitModel: string
  commitVia: CommitVia
}

export const DEFAULT_GIT_PREFS: GitPrefs = {
  refreshMs: 20_000,
  github: true,
  githubEveryMs: 3 * MINUTE,
  changelogFile: 'CHANGELOG.md',
  tagPattern: 'v[0-9]*',
  commitStyle: 'conventional',
  commitAi: true,
  commitModel: 'haiku',
  commitVia: 'auto',
}

function numberOption(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function textOption(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

export function gitPrefsFrom(options: Readonly<Record<string, unknown>>): GitPrefs {
  const d = DEFAULT_GIT_PREFS
  const changelog = options.git_changelog_file
  return {
    refreshMs: numberOption(options.git_refresh_seconds, 5, 600, d.refreshMs / 1000) * 1000,
    github: options.git_github !== 'off',
    githubEveryMs: numberOption(options.git_github_minutes, 1, 60, d.githubEveryMs / MINUTE) * MINUTE,
    // Set but empty is the person turning the warning off; never set, the default.
    changelogFile: typeof changelog === 'string' ? (changelog.trim() === '' ? null : changelog.trim()) : d.changelogFile,
    tagPattern: textOption(options.git_tag_pattern, d.tagPattern),
    commitStyle: options.git_commit_style === 'plain' ? 'plain' : 'conventional',
    commitAi: options.git_commit_ai !== false,
    commitModel: textOption(options.git_commit_model, d.commitModel),
    commitVia: options.git_commit_via === 'bash' || options.git_commit_via === 'direct' ? options.git_commit_via : 'auto',
  }
}

// ---------------------------------------------------------------- what git prints

export type Status = {
  branch: string | null
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  stash: number
  files: GitFiles
}

/**
 * `git status --porcelain=v2 --branch --show-stash -z`: the `# branch.*` and
 * `# stash` headers, then one entry per path, every field NUL-terminated; a
 * rename (`2`) carries the original path as the field after it.
 */
export function parseStatus(text: string): Status {
  const status: Status = {
    branch: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    stash: 0,
    files: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
  }
  const fields = text.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? ''
    if (field.startsWith('# ')) {
      const [key, ...rest] = field.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m !== null) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      } else if (key === 'stash') status.stash = Number(value) || 0
    } else if (field.startsWith('1 ') || field.startsWith('2 ')) {
      const x = field[2]
      const y = field[3]
      if (x !== '.') status.files.staged += 1
      if (y !== '.') status.files.modified += 1
      if (field.startsWith('2 ')) i += 1
    } else if (field.startsWith('u ')) {
      status.files.conflicts += 1
    } else if (field.startsWith('? ')) {
      status.files.untracked += 1
    }
  }
  return status
}

/** The `--git-path` names whose presence says an operation waits, most telling first. */
export const OPERATION_PATHS: readonly (readonly [GitOperation, string])[] = [
  ['rebase', 'rebase-merge'],
  ['rebase', 'rebase-apply'],
  ['merge', 'MERGE_HEAD'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD'],
  ['bisect', 'BISECT_LOG'],
]

/** `git rev-parse --path-format=absolute --show-toplevel --git-path …`: the root, then each path. */
export function parseRevParse(text: string): { root: string; paths: string[] } | undefined {
  const lines = text.split('\n').filter(l => l !== '')
  const root = lines[0]
  return root === undefined ? undefined : { root, paths: lines.slice(1) }
}

/** `git describe --tags --long`: `v0.3.0-4-gabc1234`, the tag itself may hold dashes. */
export function parseDescribe(text: string): { tag: string; since: number } | undefined {
  const m = /^(.+)-(\d+)-g[0-9a-f]+$/.exec(text.trim())
  return m === null ? undefined : { tag: m[1] ?? '', since: Number(m[2]) }
}

/** `git config --get-regexp ^remote\..*\.url$`: one `remote.<name>.url <url>` per line. */
export function parseRemotes(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[1])
    .filter((url): url is string => url !== undefined && url !== '')
}

/** The host of a remote's URL: `https://host/…`, `ssh://user@host/…` or `user@host:path`. */
export function hostOf(url: string): string | undefined {
  const scheme = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url)
  if (scheme !== null) return scheme[1]?.toLowerCase()
  const scp = /^(?:[^@/]+@)?([^/:]+):/.exec(url)
  return scp?.[1]?.toLowerCase()
}

/** Whether a remote is on GitHub: github.com, or the Enterprise host `GH_HOST` names. */
export function isGitHubRemote(url: string, ghHost?: string): boolean {
  const host = hostOf(url)
  if (host === undefined) return false
  return host === 'github.com' || host === 'ssh.github.com' || (ghHost !== undefined && ghHost !== '' && host === ghHost.toLowerCase())
}

/** `git log -1 --format=%h%x00%ct%x00%s`. */
export function parseLastCommit(text: string): GitState['lastCommit'] {
  const [hash, seconds, ...subject] = text.replace(/\n$/, '').split('\0')
  if (hash === undefined || hash === '' || seconds === undefined) return null
  return { hash, at: Number(seconds) * 1000, subject: subject.join('\0') }
}

/** The `version` of a manifest (`plugin.json`, `package.json`), when it has one. */
export function versionOf(text: string | undefined): string | null {
  if (text === undefined) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' && version.trim() !== '' ? version.trim() : null
  } catch {
    return null
  }
}

/** `x.y.z` (a `v` before it, a pre-release after it, both ignored) as three numbers. */
function semverOf(text: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text)
  return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Whether the manifest's version is past the last tag: a release CI publishes on its push. */
export function isNewerVersion(version: string, tag: string | null): boolean {
  if (tag === null) return true
  const a = semverOf(version)
  const b = semverOf(tag)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// ---------------------------------------------------------------- what gh prints

function checkFromRun(status: unknown, conclusion: unknown): Check['state'] {
  const s = String(status ?? '').toLowerCase()
  const c = String(conclusion ?? '').toLowerCase()
  if (s !== 'completed') return 'running'
  if (c === 'success') return 'ok'
  if (c === 'skipped' || c === 'neutral') return 'skipped'
  return 'failed'
}

function checkFromContext(state: unknown): Check['state'] {
  const s = String(state ?? '').toLowerCase()
  if (s === 'success') return 'ok'
  if (s === 'pending' || s === 'expected') return 'running'
  return 'failed'
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** `statusCheckRollup` of `gh pr view --json`: check runs and commit statuses alike. */
export function checksOf(rollup: unknown): Check[] {
  if (!Array.isArray(rollup)) return []
  const byName = new Map<string, Check>()
  for (const item of rollup) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const isContext = r.__typename === 'StatusContext' || (r.context !== undefined && r.status === undefined)
    const name = stringOf(isContext ? r.context : r.name) ?? stringOf(r.workflowName) ?? '?'
    const url = stringOf(isContext ? r.targetUrl : r.detailsUrl)
    const state = isContext ? checkFromContext(r.state) : checkFromRun(r.status, r.conclusion)
    byName.set(name, url === undefined ? { name, state } : { name, state, url })
  }
  return [...byName.values()]
}

/** `gh pr view --json number,title,url,state,isDraft,headRefOid,statusCheckRollup`. */
export function parsePullRequest(text: string): { pr: PullRequest; checks: Check[]; sha: string | null } | undefined {
  try {
    const r = JSON.parse(text) as Record<string, unknown>
    if (typeof r.number !== 'number') return undefined
    const state = String(r.state ?? '').toLowerCase()
    return {
      pr: {
        number: r.number,
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
        isDraft: r.isDraft === true,
      },
      checks: checksOf(r.statusCheckRollup),
      sha: stringOf(r.headRefOid) ?? null,
    }
  } catch {
    return undefined
  }
}

/**
 * `gh run list --json status,conclusion,workflowName,headSha,url`, newest
 * first: the runs of the newest commit, one per workflow.
 */
export function parseRuns(text: string): { checks: Check[]; sha: string | null } {
  try {
    const runs = JSON.parse(text) as unknown
    if (!Array.isArray(runs) || runs.length === 0) return { checks: [], sha: null }
    const sha = stringOf((runs[0] as Record<string, unknown>).headSha) ?? null
    const byName = new Map<string, Check>()
    for (const run of runs) {
      const r = run as Record<string, unknown>
      if (stringOf(r.headSha) !== sha) continue
      const name = stringOf(r.workflowName) ?? '?'
      if (byName.has(name)) continue
      const url = stringOf(r.url)
      const state = checkFromRun(r.status, r.conclusion)
      byName.set(name, url === undefined ? { name, state } : { name, state, url })
    }
    return { checks: [...byName.values()], sha }
  } catch {
    return { checks: [], sha: null }
  }
}

// ---------------------------------------------------------------- the row

export type GitView = {
  git: GitState
  github: GitHubState | null
  words: GitWords
  prefs: GitPrefs
  now: number
}

type Ci = { total: number; failed: number; running: number; isOlder: boolean }

function ciOf(view: GitView): Ci | undefined {
  const { github, git } = view
  if (github === null || github.root !== git.root || github.branch !== git.branch) return undefined
  const counted = github.checks.filter(c => c.state !== 'skipped')
  if (counted.length === 0) return undefined
  return {
    total: counted.length,
    failed: counted.filter(c => c.state === 'failed').length,
    running: counted.filter(c => c.state === 'running').length,
    isOlder: github.checksSha !== null && git.oid !== null && github.checksSha !== git.oid,
  }
}

function prOf(view: GitView): PullRequest | undefined {
  const { github, git } = view
  if (github === null || github.root !== git.root || github.branch !== git.branch) return undefined
  return github.pr ?? undefined
}

const RANK: Record<Tone, number> = { bad: 5, warn: 4, info: 3, merged: 2, ok: 1, text: 0, muted: 0 }

function worst(tones: readonly Tone[]): Tone {
  let found: Tone = 'ok'
  for (const tone of tones) if (RANK[tone] > RANK[found]) found = tone
  return found
}

/** One block of the row: its parts, joined with ` · `, and whether it is only good news. */
type Block = { parts: Segment[]; isGood: boolean }

const seg = (text: string, tone: Tone): Segment => ({ text, tone })

/**
 * How much the row carries, richest first. `compactFiles` sums the files into
 * changes; `shortVersion` writes the version tightly; `shortCi` drops the
 * checks' counts; `noVersion` drops the version, the changelog and the stash;
 * `problemsOnly` keeps only what asks for attention; `bare` the branch and
 * the worst word.
 */
const DETAILS = ['full', 'compactFiles', 'shortVersion', 'shortCi', 'noVersion', 'problemsOnly'] as const
type Detail = (typeof DETAILS)[number]

function atLeast(detail: Detail, than: Detail): boolean {
  return DETAILS.indexOf(detail) >= DETAILS.indexOf(than)
}

function filesBlock(view: GitView, detail: Detail): Block {
  const { git, words } = view
  const { staged, modified, untracked, conflicts } = git.files
  const parts: Segment[] = []
  if (git.operation !== null) parts.push(seg(words.operations[git.operation], 'warn'))
  if (conflicts > 0) parts.push(seg(words.conflicts(conflicts), 'bad'))
  if (atLeast(detail, 'compactFiles')) {
    const changes = staged + modified
    if (changes > 0) parts.push(seg(words.changes(changes), 'warn'))
  } else {
    if (staged > 0) parts.push(seg(words.staged(staged), 'warn'))
    if (modified > 0) parts.push(seg(words.modified(modified), 'warn'))
  }
  if (untracked > 0 && !atLeast(detail, 'problemsOnly')) parts.push(seg(words.untracked(untracked), 'muted'))
  if (git.stash > 0 && !atLeast(detail, 'noVersion')) parts.push(seg(words.stashed(git.stash), 'muted'))
  if (parts.length === 0 && git.oid !== null) return { parts: [seg(words.clean, 'ok')], isGood: true }
  return { parts, isGood: false }
}

function syncBlock(view: GitView): Block {
  const { git, words } = view
  if (git.oid === null) return { parts: [], isGood: true }
  if (git.remotes.length === 0) return { parts: [seg(words.noRemote, 'muted')], isGood: false }
  if (git.upstream === null) {
    if (git.unpushed !== null && git.unpushed > 0) return { parts: [seg(words.notPushed(git.unpushed), 'warn')], isGood: false }
    return { parts: [seg(words.branchNotPushed, 'muted')], isGood: false }
  }
  const { ahead, behind } = git
  if (ahead > 0 && behind > 0) return { parts: [seg(words.toPush(ahead), 'bad'), seg(words.toPull(behind), 'bad')], isGood: false }
  if (ahead > 0) return { parts: [seg(words.toPush(ahead), 'warn')], isGood: false }
  if (behind > 0) return { parts: [seg(words.toPull(behind), 'warn')], isGood: false }
  return { parts: [seg(words.upToDate, 'ok')], isGood: true }
}

function ciBlock(view: GitView, detail: Detail): Block {
  const { words } = view
  const pr = prOf(view)
  if (pr?.state === 'merged') return { parts: [seg(words.prMerged, 'merged')], isGood: false }
  if (pr?.state === 'closed') return { parts: [seg(words.prClosed, 'muted')], isGood: false }
  const ci = ciOf(view)
  if (ci === undefined) return { parts: [], isGood: true }
  const short = atLeast(detail, 'shortCi')
  if (ci.failed > 0) {
    const text = short ? words.ciFailingShort : words.ciFailing(ci.failed, ci.total)
    return { parts: [seg(text, ci.isOlder ? 'muted' : 'bad')], isGood: false }
  }
  if (ci.running > 0) {
    const text = short ? words.ciRunningShort : words.ciRunning(ci.running, ci.total)
    return { parts: [seg(text, ci.isOlder ? 'muted' : 'info')], isGood: false }
  }
  return { parts: [seg(words.ciOk, ci.isOlder ? 'muted' : 'ok')], isGood: true }
}

function versionBlock(view: GitView, detail: Detail): Block {
  const { git, words, prefs } = view
  if (atLeast(detail, 'noVersion')) return { parts: [], isGood: true }
  const parts: Segment[] = []
  if (git.tag !== null) {
    const short = atLeast(detail, 'shortVersion')
    if (git.sinceTag > 0) parts.push(seg(short ? `${git.tag}+${git.sinceTag}` : words.unreleased(git.tag, git.sinceTag), 'muted'))
    else parts.push(seg(git.tag, 'muted'))
  }
  if (git.version !== null && isNewerVersion(git.version, git.tag)) parts.push(seg(words.releasePending(git.version), 'info'))
  if (prefs.changelogFile !== null && git.changelogTouched === false && git.sinceTag > 0) parts.push(seg(words.changelogStale, 'warn'))
  return { parts, isGood: parts.every(p => p.tone === 'muted') }
}

const DIVIDER: Record<Style, string> = { footer: ' │ ', band: '  │  ' }

function branchName(git: GitState, words: GitWords): string {
  if (git.branch !== null) return git.branch
  return git.oid === null ? words.detached : `${words.detached} ${git.oid.slice(0, 7)}`
}

function rowOf(view: GitView, detail: Detail, style: Style): Row {
  const { git, words } = view
  let blocks = [filesBlock(view, detail), syncBlock(view), ciBlock(view, detail), versionBlock(view, detail)]
  if (atLeast(detail, 'problemsOnly')) {
    blocks = blocks.map(b => ({ ...b, parts: b.parts.filter(p => p.tone !== 'ok' && p.tone !== 'muted') }))
  }
  const shown = blocks.filter(b => b.parts.length > 0)
  const tone = worst(blocks.flatMap(b => b.parts.map(p => p.tone)))
  const head: Segment[] = [{ text: branchName(git, words), tone, isBold: true }]
  if (git.oid === null) head.push(seg(` ${words.noCommits}`, 'muted'))
  const divider = seg(DIVIDER[style], 'muted')
  const row: Row = [...head]
  for (const block of shown) {
    row.push(divider)
    block.parts.forEach((part, i) => {
      if (i > 0) row.push(seg(' · ', 'muted'))
      row.push(part)
    })
  }
  return row
}

/**
 * The last resort: the branch, cut with `..` (`…` is ambiguous in width) when
 * even the worst word would not fit beside it, then the problems, worst first,
 * as many as fit.
 */
function bareOf(view: GitView, width: number, style: Style): Row {
  const full = rowOf(view, 'problemsOnly', style)
  const head = full[0]
  if (head === undefined) return []
  const problems = full
    .slice(1)
    .filter(s => s.tone !== 'muted' && s.tone !== 'text')
    .map((s, i) => ({ s, i }))
    .sort((a, b) => RANK[b.s.tone] - RANK[a.s.tone] || a.i - b.i)
    .map(({ s }) => s)
  const first = problems[0]
  const room = Math.max(1, width - (first === undefined ? 0 : first.text.length + 1))
  const name = head.text.length > room ? `${head.text.slice(0, Math.max(1, room - 2))}..` : head.text
  const row: Row = [{ ...head, text: name }]
  let used = name.length
  problems.forEach((problem, i) => {
    const gap = i === 0 ? ' ' : ' · '
    if (used + gap.length + problem.text.length > width) return
    row.push(seg(gap, 'muted'), problem)
    used += gap.length + problem.text.length
  })
  return row
}

/** The row that fits `width`, richest first: what goes as room runs out is in DETAILS. */
export function fitGitLine(view: GitView, width: number, style: Style = 'band'): Row {
  for (const detail of DETAILS) {
    const row = rowOf(view, detail, style)
    if (textOf(row).length <= width) return row
  }
  return bareOf(view, width, style)
}

/** Whether the row offers the commit dialog: changes to commit and nothing half done. */
export function canCommit(git: GitState): boolean {
  const { staged, modified, untracked, conflicts } = git.files
  return conflicts === 0 && git.operation !== 'rebase' && staged + modified + untracked > 0
}

/** The worst tone of the row, for a mark elsewhere. */
export function toneOf(view: GitView): Tone {
  return worst(rowOf(view, 'full', 'band').slice(1).map(s => s.tone))
}

// ---------------------------------------------------------------- the detail

function repoName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}

/** The detail `/mk-usage` shows under the quota: git first, then GitHub. */
export function gitDetailRows(view: GitView): Row[] {
  const { git, words, prefs, now } = view
  const indent = '  '
  const rows: Row[] = []
  const headTone = worst(rowOf(view, 'full', 'band').slice(1).map(s => s.tone))
  rows.push([
    { text: `${words.section} · ${repoName(git.root)} · `, tone: 'text' },
    { text: branchName(git, words), tone: headTone, isBold: true },
  ])

  const sync: Segment[] = []
  if (git.remotes.length === 0) sync.push(seg(words.noRemote, 'muted'))
  else if (git.upstream === null) {
    sync.push(seg(words.noUpstream, 'muted'))
    if (git.unpushed !== null && git.unpushed > 0) sync.push(seg(words.notPushed(git.unpushed), 'warn'))
  } else {
    sync.push(seg(words.upstream(git.upstream), 'muted'), ...syncBlock(view).parts)
  }
  rows.push([seg(indent, 'muted'), ...joinParts(sync)])

  const files = filesBlock(view, 'full').parts
  if (files.length > 0) rows.push([seg(indent, 'muted'), ...joinParts(files)])

  if (git.lastCommit !== null) {
    const ago = words.ago(duration(Math.max(0, now - git.lastCommit.at)))
    rows.push([seg(indent + words.lastCommit(git.lastCommit.hash, ago, git.lastCommit.subject), 'muted')])
  }

  const version: Segment[] = []
  if (git.tag === null) version.push(seg(words.noTags, 'muted'))
  else version.push(seg(words.sinceTag(git.tag, git.sinceTag), 'muted'))
  if (git.version !== null && isNewerVersion(git.version, git.tag)) version.push(seg(words.releasePending(git.version), 'info'))
  if (prefs.changelogFile !== null && git.tag !== null && git.changelogTouched !== null) {
    version.push(
      git.changelogTouched || git.sinceTag === 0
        ? seg(words.changelogTouched(prefs.changelogFile), 'muted')
        : seg(words.changelogStaleSince(prefs.changelogFile, git.tag), 'warn'),
    )
  }
  rows.push([seg(indent, 'muted'), ...joinParts(version)])
  if (git.isSlow) rows.push([seg(indent + words.slow, 'muted')])

  rows.push([{ text: 'GitHub', tone: 'text' }])
  const github = view.github !== null && view.github.root === git.root ? view.github : null
  if (github === null) return rows
  if (github.unavailable !== null) {
    rows.push([seg(indent + words.unavailable[github.unavailable], 'muted')])
    return rows
  }
  const pr = prOf(view)
  if (pr === undefined) rows.push([seg(indent + words.noPr, 'muted')])
  else {
    const state = pr.state === 'merged' ? words.prMerged : pr.state === 'closed' ? words.prClosed : pr.isDraft ? words.prDraft : undefined
    const prTone: Tone = pr.state === 'merged' ? 'merged' : 'text'
    rows.push([seg(indent, 'muted'), seg(words.pr(pr.number, pr.title), prTone), ...(state === undefined ? [] : [seg(` (${state})`, 'muted')])])
  }
  const ci = ciOf(view)
  if (ci !== undefined && github.checksSha !== null) {
    const counts = (['ok', 'failed', 'running'] as const)
      .map(state => [state, github.checks.filter(c => c.state === state).length] as const)
      .filter(([, n]) => n > 0)
      .map(([state, n]) => `${n} ${words.checkStates[state]}`)
    const older = ci.isOlder ? ` (${words.ciOlder})` : ''
    rows.push([seg(`${indent}${words.checksOf(github.checksSha.slice(0, 7))}${older}: `, 'muted'), seg(counts.join(', '), ciBlock(view, 'full').parts[0]?.tone ?? 'muted')])
    const notable = github.checks.filter(c => c.state === 'failed' || c.state === 'running').slice(0, 6)
    for (const check of notable) {
      rows.push([seg(`${indent}${indent}`, 'muted'), seg(words.checkStates[check.state], check.state === 'failed' ? 'bad' : 'info'), seg(`  ${check.name}`, 'muted')])
    }
  }
  if (pr !== undefined && pr.url !== '') rows.push([seg(indent + pr.url, 'muted')])
  return rows
}

function joinParts(parts: readonly Segment[]): Segment[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [seg(' · ', 'muted'), part]))
}
