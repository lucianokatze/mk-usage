// mk-usage: the plan's limits (the 5-hour session and the week), where each
// ends at the reset at the current pace, and when the subscription renews;
// and the repository the session works in: branch, changes, sync with the
// remote, the CI of its pull request, the version and the changelog.
//
// The quota, by default, at the end of the hint line under the prompt, a row
// that is there anyway: named blocks, `Sesión 5h │ Semana │ Renueva`, in
// Claude's gray (the engine paints that line itself). Git, by default, on one
// row of the band above the prompt, colored by state, with a `c: commit`
// button that opens the commit dialog. `/mk-usage` opens the detail of both,
// `/mk-usage [git] franja|pie|oculto` moves either. Every word, threshold and
// default is the person's (the manifest's `userConfig`). It reads what the
// engine, git and gh already have: no model call, save the dialog's "write
// with Claude" button, which spends tokens only when pressed.

import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, PluginOptions, ProcessRunResult, Register, RenderElement, SessionRateLimit, TextProps } from 'claude-code'

import type { CommitDraft, GitHubState, GitState, Placement, PlacementChoice, Reading } from '../types'
import { DIFF_LIMIT, commitPrompt, commitSystem, draftSubject, messageOf, parseNameStatus, parseReply } from './commit'
import {
  OPERATION_PATHS,
  canCommit,
  fitGitLine,
  gitDetailRows,
  gitPrefsFrom,
  isGitHubRemote,
  parseDescribe,
  parseLastCommit,
  parsePullRequest,
  parseRemotes,
  parseRevParse,
  parseRuns,
  parseStatus,
  versionOf,
} from './git'
import type { GitPrefs, GitView } from './git'
import {
  PLACEMENTS,
  addSamples,
  detailRows,
  fitLine,
  isHistory,
  isReading,
  keyFor,
  parseOffset,
  placementFrom,
  placementOf,
  prefsFrom,
  profileFrom,
  textOf,
} from './usage'
import type { Row, Segment, Tone, View } from './usage'
import { WORDS } from './words'
import type { Words } from './words'

const reading = atom({ plugin: 'mk-usage', key: 'reading' } as const, null)
const history = atom({ plugin: 'mk-usage', key: 'history' } as const, {})
const profile = atom({ plugin: 'mk-usage', key: 'profile' } as const, null)
const placement = atom({ plugin: 'mk-usage', key: 'placement' } as const, 'footer')
const repo = atom({ plugin: 'mk-usage', key: 'git' } as const, null)
const github = atom({ plugin: 'mk-usage', key: 'github' } as const, null)
const gitPlacement = atom({ plugin: 'mk-usage', key: 'gitPlacement' } as const, 'band')
const commit = atom({ plugin: 'mk-usage', key: 'commit' } as const, null)

const PANE = 'mk-usage'
const COMMIT_PANE = 'mk-usage-commit'
const TICK_MS = 30_000
/** Ticks between two readings of the profile: an hour, for a clock change or a /login. */
const PROFILE_EVERY = 120

// git and gh run without prompts, locks or translations (only exit codes are
// read); a status slower than SLOW_MS twice stops counting untracked files.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
const GH_ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1' }
const GIT_TIMEOUT_MS = 5_000
const GH_TIMEOUT_MS = 15_000
const COMMIT_TIMEOUT_MS = 60_000
const SLOW_MS = 2_000
/** How often the GitHub schedule is looked at; a read happens only when due. */
const GITHUB_TICK_MS = 5_000
/** While checks run, GitHub is read this often; after a push, again at these delays. */
const CHECKS_RUNNING_MS = 30_000
const AFTER_PUSH_MS = [10_000, 30_000] as const
const MAX_BACKOFF_MS = 15 * 60_000
/** The columns `c: commit` takes at the band's right end, with its gap. */
const COMMIT_BUTTON_COLUMNS = 11
const MIN_BAND_FOR_BUTTON = 60
const MIN_FOOTER_GIT = 12
const LISTED_FILES = 8
/** Lockfiles say nothing about why: Claude does not read them. */
const DIFF_EXCLUDES = [':(exclude)*.lock', ':(exclude)package-lock.json', ':(exclude)pnpm-lock.yaml', ':(exclude)bun.lockb']
const TOOLS_THAT_CHANGE_FILES = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Theme keys, so the colors follow the person's theme (daltonized ones
// included); `inactive` is the gray of Claude's own footer.
const COLORS: Record<Tone, string | undefined> = {
  text: undefined,
  muted: 'inactive',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  info: 'suggestion',
  merged: 'merged',
}

function styleOf(segment: Segment): { color?: string; bold?: boolean } {
  const color = COLORS[segment.tone]
  return { ...(color === undefined ? {} : { color }), ...(segment.isBold === true ? { bold: true } : {}) }
}

// ------------------------------------------------------------------ the quota

/** Copies what the store keeps for this account (every session shares it) into this session's state. */
async function loadSaved($: EngineInterface, configDefault: Placement, gitDefault: Placement): Promise<void> {
  const who = await read($, profile)
  // Figures stored before they were kept per account sit under the bare key:
  // taken once, until this account stores its own.
  const savedReading = (await $.store.get(keyFor('reading', who))) ?? (await $.store.get('reading'))
  const savedHistory = (await $.store.get(keyFor('history', who))) ?? (await $.store.get('history'))
  const savedPlacement = await $.store.get('placement')
  const savedGitPlacement = await $.store.get('gitPlacement')
  await update($, reading, () => (isReading(savedReading) ? savedReading : null))
  await update($, history, () => (isHistory(savedHistory) ? savedHistory : {}))
  await update($, placement, () => placementFrom(savedPlacement, configDefault))
  gitShownAt = placementFrom(savedGitPlacement, gitDefault)
  await update($, gitPlacement, () => gitShownAt)
}

/** Minutes east of UTC; asks `date` only when the runtime reports UTC. */
async function localOffset($: EngineInterface): Promise<number> {
  const fromRuntime = -new Date().getTimezoneOffset()
  if (fromRuntime !== 0) return fromRuntime
  try {
    const run = await $.process.run(['date', '+%z'])
    return parseOffset(run.stdout) ?? fromRuntime
  } catch {
    return fromRuntime
  }
}

/** The locale the system's messages use, the first set of the usual variables. */
async function systemLocale($: EngineInterface): Promise<string | undefined> {
  const all = await $.env.get('LC_ALL')
  const messages = await $.env.get('LC_MESSAGES')
  const lang = await $.env.get('LANG')
  return [all, messages, lang].find(value => value !== undefined && value !== '')
}

/**
 * The machine's clock and locale, and from `.claude.json` (where the
 * configuration lives, or the home folder: `HOME`, `USERPROFILE` on Windows)
 * the plan and the account; never the credentials.
 */
async function loadProfile($: EngineInterface): Promise<void> {
  const tzOffsetMin = await localOffset($)
  const locale = await systemLocale($)
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const userProfile = await $.env.get('USERPROFILE')
  const dirs = [configDir, home, userProfile].filter((dir): dir is string => dir !== undefined && dir !== '')
  let text: string | undefined
  for (const dir of dirs) {
    try {
      text = await $.fs.read(`${dir}/.claude.json`)
      break
    } catch {
      // Not there: try the next place.
    }
  }
  const found = profileFrom(text, tzOffsetMin, locale)
  await update($, profile, () => found)
}

/** Keeps a non-empty set of windows as the reading, here and in the store, under the account. */
async function record($: EngineInterface, limits: readonly SessionRateLimit[]): Promise<void> {
  if (limits.length === 0) return
  const at = await $.clock.now()
  const who = await read($, profile)
  const fresh: Reading = {
    at,
    limits: limits.map(l =>
      l.resetsAt === undefined
        ? { kind: l.kind, percentUsed: l.percentUsed }
        : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt },
    ),
  }
  await update($, reading, () => fresh)
  await $.store.set(keyFor('reading', who), fresh)
  const saved = await $.store.get(keyFor('history', who))
  const base = isHistory(saved) ? saved : await read($, history)
  const merged = addSamples(base, fresh.limits, at)
  await update($, history, () => merged)
  await $.store.set(keyFor('history', who), merged)
}

/** Takes a newer reading another session of the same account stored. */
async function takeNewer($: EngineInterface): Promise<void> {
  const who = await read($, profile)
  const saved = await $.store.get(keyFor('reading', who))
  const current = await read($, reading)
  if (isReading(saved) && (current === null || saved.at > current.at)) {
    await update($, reading, () => saved)
    const savedHistory = await $.store.get(keyFor('history', who))
    if (isHistory(savedHistory)) await update($, history, () => savedHistory)
  }
}

/** What every drawing of the quota reads; reading it while drawing subscribes the drawing. */
async function viewOf($: EngineInterface, options: PluginOptions): Promise<View | null> {
  const current = await read($, reading)
  if (current === null) return null
  const who = await read($, profile)
  return {
    reading: current,
    history: await read($, history),
    profile: who,
    prefs: prefsFrom(options, who?.locale),
    now: await $.clock.now(),
  }
}

async function wordsOf($: EngineInterface, options: PluginOptions): Promise<Words> {
  return prefsFrom(options, (await read($, profile))?.locale).words
}

let ticks = 0

/**
 * Every 30 seconds: a newer reading another session stored, the countdowns
 * redrawn; every hour, the profile again (a clock change, a /login to another
 * account, whose own figures are then loaded).
 */
async function tick($: EngineInterface, configDefault: Placement, gitDefault: Placement): Promise<void> {
  ticks += 1
  try {
    if (ticks % PROFILE_EVERY === 0) {
      const before = (await read($, profile))?.account
      await loadProfile($)
      if ((await read($, profile))?.account !== before) await loadSaved($, configDefault, gitDefault)
    }
    await takeNewer($)
  } catch {
    // The line keeps what it has.
  }
  $.ui.invalidate('ui.render')
}

// ------------------------------------------------------------------ git

// The module's own bookkeeping (a reload starts it over): the reads in flight,
// the last snapshot and where git shows. Work that runs past the dispatch that
// started it (a read another event joined, a timer) decides from these, never
// from `$.state`, which it only writes for the drawings to read.
let lastGit: GitState | null = null
let gitShownAt: Placement = 'band'
let gitRun: Promise<void> | null = null
let gitAgain = false
let slowReads = 0
let isSlow = false
let gitTicks = 0
let githubRun: Promise<void> | null = null
let githubAgain = false
let githubDueAt = 0
let githubFailures = 0
/** Why GitHub is out of reach for a repository, until `/mk-usage actualizar` or the next session. */
const githubBlocked = new Map<string, NonNullable<GitHubState['unavailable']>>()
let isDetailOpen = false
let isCommitOpen = false
let generation: AbortController | null = null

/** One git command, in the repository's root: its result, or undefined when git did not run. */
async function git($: EngineInterface, cwd: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS): Promise<ProcessRunResult | undefined> {
  try {
    return await $.process.run(['git', ...args], { cwd, env: GIT_ENV, timeoutMs })
  } catch {
    return undefined
  }
}

async function gh($: EngineInterface, cwd: string, args: readonly string[]): Promise<ProcessRunResult | undefined> {
  try {
    return await $.process.run(['gh', ...args], { cwd, env: GH_ENV, timeoutMs: GH_TIMEOUT_MS })
  } catch {
    return undefined
  }
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

/** The repository the session's directory is in, read with git alone; null outside one. */
async function readGit($: EngineInterface, prefs: GitPrefs): Promise<GitState | null> {
  const cwd = await $.session.cwd()
  const paths = OPERATION_PATHS.flatMap(([, name]) => ['--git-path', name])
  const located = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', ...paths])
  if (located === undefined || located.exitCode !== 0) return null
  const where = parseRevParse(located.stdout)
  if (where === undefined) return null
  const { root } = where

  const startedAt = await $.clock.now()
  const statusArgs = ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--show-stash', '-z']
  const [status, remotes, described, last] = await Promise.all([
    git($, root, isSlow ? [...statusArgs, '--untracked-files=no'] : statusArgs),
    git($, root, ['config', '--get-regexp', '^remote\\..*\\.url$']),
    git($, root, ['describe', '--tags', '--long', '--match', prefs.tagPattern]),
    git($, root, ['log', '-1', '--format=%h%x00%ct%x00%s']),
  ])
  if (status === undefined || status.exitCode !== 0) return null
  const now = await $.clock.now()
  if (now - startedAt > SLOW_MS) slowReads += 1
  if (slowReads >= 2) isSlow = true

  const parsed = parseStatus(status.stdout)
  const remoteUrls = remotes?.exitCode === 0 ? parseRemotes(remotes.stdout) : []
  const tagged = described?.exitCode === 0 ? parseDescribe(described.stdout) : undefined
  const exists = await Promise.all(where.paths.map(p => $.fs.exists(p).catch(() => false)))
  const operation = OPERATION_PATHS.find((_, i) => exists[i] === true)?.[0] ?? null

  let changelogTouched: boolean | null = null
  if (prefs.changelogFile !== null && tagged !== undefined && (await $.fs.exists(`${root}/${prefs.changelogFile}`).catch(() => false))) {
    const diff = await git($, root, ['diff', '--quiet', tagged.tag, '--', prefs.changelogFile])
    if (diff?.exitCode === 0) changelogTouched = false
    else if (diff?.exitCode === 1) changelogTouched = true
  }

  let unpushed: number | null = null
  if (parsed.upstream === null && parsed.oid !== null && remoteUrls.length > 0) {
    const count = await git($, root, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
    if (count?.exitCode === 0) unpushed = Number(count.stdout.trim()) || 0
  }

  const manifest = (await readText($, `${root}/.claude-plugin/plugin.json`)) ?? (await readText($, `${root}/package.json`))

  return {
    root,
    branch: parsed.branch,
    oid: parsed.oid,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    unpushed,
    remotes: remoteUrls,
    files: parsed.files,
    stash: parsed.stash,
    operation,
    tag: tagged?.tag ?? null,
    sinceTag: tagged?.since ?? 0,
    changelogTouched,
    version: versionOf(manifest),
    lastCommit: last?.exitCode === 0 ? parseLastCommit(last.stdout) : null,
    isSlow,
    at: now,
  }
}

function sameGit(a: GitState | null, b: GitState | null): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 })
}

/**
 * Reads the repository again, at most one read at a time: a call while one
 * runs asks for one more after it. A new branch or head asks GitHub too.
 */
async function refreshGit($: EngineInterface, options: PluginOptions): Promise<void> {
  if (gitRun !== null) {
    gitAgain = true
    return gitRun
  }
  gitRun = (async () => {
    try {
      do {
        gitAgain = false
        const before = lastGit
        const state = await readGit($, gitPrefsFrom(options)).catch(() => null)
        lastGit = state
        if (!sameGit(before, state)) await update($, repo, () => state)
        if (state !== null && (before?.root !== state.root || before?.branch !== state.branch || before?.oid !== state.oid)) {
          githubDueAt = 0
        }
      } while (gitAgain)
    } finally {
      gitRun = null
    }
  })()
  return gitRun
}

/** What GitHub says of the branch through `gh`, or why it says nothing. */
async function readGitHub($: EngineInterface, state: GitState, prefs: GitPrefs): Promise<GitHubState> {
  const base = { root: state.root, branch: state.branch, pr: null, checks: [], checksSha: null, at: await $.clock.now() }
  const quiet = await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
  if (!prefs.github || (quiet !== undefined && quiet !== '' && quiet !== '0')) return { ...base, unavailable: 'off' }
  const ghHost = await $.env.get('GH_HOST')
  if (!state.remotes.some(url => isGitHubRemote(url, ghHost))) return { ...base, unavailable: 'not-github' }
  const blocked = githubBlocked.get(state.root)
  if (blocked !== undefined) return { ...base, unavailable: blocked }

  const refuse = (run: ProcessRunResult | undefined): GitHubState['unavailable'] => {
    if (run === undefined) return 'gh-missing'
    if (run.exitCode === 4) return 'gh-auth'
    return null
  }
  if (state.branch !== null) {
    const pr = await gh($, state.root, ['pr', 'view', '--json', 'number,title,url,state,isDraft,headRefOid,statusCheckRollup'])
    const refused = refuse(pr)
    if (refused !== null) {
      githubBlocked.set(state.root, refused)
      return { ...base, unavailable: refused }
    }
    const found = pr?.exitCode === 0 ? parsePullRequest(pr.stdout) : undefined
    if (found !== undefined) return { ...base, pr: found.pr, checks: found.checks, checksSha: found.sha, unavailable: null }
    // No pull request for the branch (gh exits 1): the branch's own workflow runs.
  }
  const which = state.branch !== null ? ['--branch', state.branch] : state.oid !== null ? ['--commit', state.oid] : undefined
  if (which === undefined) return { ...base, unavailable: null }
  const runs = await gh($, state.root, ['run', 'list', ...which, '--limit', '10', '--json', 'status,conclusion,workflowName,headSha,url'])
  const refused = refuse(runs)
  if (refused !== null) {
    githubBlocked.set(state.root, refused)
    return { ...base, unavailable: refused }
  }
  if (runs?.exitCode !== 0) return { ...base, unavailable: 'failed' }
  const found = parseRuns(runs.stdout)
  return { ...base, checks: found.checks, checksSha: found.sha, unavailable: null }
}

/**
 * Reads GitHub and sets when the next read is due: sooner while checks run,
 * later after failures. A call while one runs asks for one more after it.
 */
async function refreshGitHub($: EngineInterface, options: PluginOptions): Promise<void> {
  if (githubRun !== null) {
    githubAgain = true
    return githubRun
  }
  githubRun = (async () => {
    try {
      do {
        githubAgain = false
        await readGitHubOnce($, options)
      } while (githubAgain)
    } finally {
      githubRun = null
    }
  })()
  return githubRun
}

async function readGitHubOnce($: EngineInterface, options: PluginOptions): Promise<void> {
  try {
    const prefs = gitPrefsFrom(options)
    const state = lastGit
    const now = await $.clock.now()
    if (state === null) {
      githubDueAt = now + prefs.githubEveryMs
      return
    }
    const found = await readGitHub($, state, prefs)
    await update($, github, () => found)
    if (found.unavailable === 'failed') {
      githubFailures += 1
      githubDueAt = now + Math.min(MAX_BACKOFF_MS, CHECKS_RUNNING_MS * 2 ** githubFailures)
    } else {
      githubFailures = 0
      const isRunning = found.checks.some(c => c.state === 'running')
      githubDueAt = now + (isRunning ? CHECKS_RUNNING_MS : prefs.githubEveryMs)
    }
  } catch {
    githubDueAt = (await $.clock.now()) + CHECKS_RUNNING_MS
  }
}

/** Whether anything shows git now: the row, the detail or the dialog. */
function isGitShown(): boolean {
  return isDetailOpen || isCommitOpen || gitShownAt !== 'hidden'
}

/** Every `git_refresh_seconds`: the repository again; a slow one every fourth time. */
async function gitTick($: EngineInterface, options: PluginOptions): Promise<void> {
  gitTicks += 1
  if (isSlow && gitTicks % 4 !== 0) return
  if (isGitShown()) await refreshGit($, options)
}

async function githubTick($: EngineInterface, options: PluginOptions): Promise<void> {
  if ((await $.clock.now()) < githubDueAt || !isGitShown()) return
  await refreshGitHub($, options)
}

/** After a push or a pull request command: GitHub now, and again while the checks start. */
function askGitHubSoon($: EngineInterface, options: PluginOptions): void {
  githubDueAt = 0
  for (const ms of AFTER_PUSH_MS) {
    $.clock.after(ms, () => {
      githubDueAt = 0
      void githubTick($, options)
    })
  }
}

/** What every drawing of git reads. */
async function gitViewOf($: EngineInterface, options: PluginOptions): Promise<GitView | null> {
  const state = await read($, repo)
  if (state === null) return null
  return {
    git: state,
    github: await read($, github),
    words: (await wordsOf($, options)).git,
    prefs: gitPrefsFrom(options),
    now: await $.clock.now(),
  }
}

// ------------------------------------------------------------------ the commit dialog

async function stagedFiles($: EngineInterface, root: string) {
  const listed = await git($, root, ['diff', '--cached', '--name-status', '-z'])
  return listed?.exitCode === 0 ? parseNameStatus(listed.stdout) : []
}

/** The dialog's state from the index: the staged files and a first draft of the subject. */
async function draftFor($: EngineInterface, options: PluginOptions, state: GitState, keep?: CommitDraft): Promise<CommitDraft> {
  const prefs = gitPrefsFrom(options)
  const words = (await wordsOf($, options)).git
  const files = await stagedFiles($, state.root)
  const draft = draftSubject(files, words, prefs.commitStyle, { changelogFile: prefs.changelogFile, version: state.version })
  // A subject the person wrote, or Claude did, stays; the draft follows the index.
  const previous = keep === undefined ? undefined : draftSubject(keep.files, words, prefs.commitStyle, { changelogFile: prefs.changelogFile, version: state.version })
  const isTheirs = keep !== undefined && keep.subject.trim() !== '' && keep.subject !== previous
  return {
    files,
    unstaged: state.files.modified + state.files.untracked,
    subject: isTheirs ? keep.subject : draft,
    body: keep?.body ?? '',
    busy: null,
    note: null,
  }
}

async function openCommit($: EngineInterface, options: PluginOptions): Promise<void> {
  await refreshGit($, options)
  const state = lastGit
  const words = (await wordsOf($, options)).git
  if (state === null) {
    $.ui.toast(words.notRepo)
    return
  }
  const draft = await draftFor($, options, state)
  await update($, commit, () => draft)
  isCommitOpen = true
  await $.ui.open({ id: COMMIT_PANE, title: words.commitIn(state.branch ?? words.detached), focus: true, closeOnEscape: true, rows: 16 })
}

async function stageAll($: EngineInterface, options: PluginOptions): Promise<void> {
  const state = lastGit
  if (state === null) return
  await git($, state.root, ['add', '-A'], COMMIT_TIMEOUT_MS)
  await refreshGit($, options)
  const fresh = lastGit
  const keep = await read($, commit)
  if (fresh === null || keep === null) return
  const draft = await draftFor($, options, fresh, keep)
  await update($, commit, () => draft)
}

async function note($: EngineInterface, text: string | null, busy: CommitDraft['busy'] = null): Promise<void> {
  await update($, commit, d => (d === null ? d : { ...d, note: text, busy }))
}

/** "Write with Claude": the one place the mod spends tokens, and only when pressed. */
async function generateMessage($: EngineInterface, options: PluginOptions): Promise<void> {
  const draft = await read($, commit)
  const state = lastGit
  const words = (await wordsOf($, options)).git
  const prefs = gitPrefsFrom(options)
  if (draft === null || state === null || draft.busy !== null || !prefs.commitAi) return
  if (draft.files.length === 0) {
    await note($, words.nothingStaged)
    return
  }
  await note($, null, 'generating')
  const [subjects, stat, diff] = await Promise.all([
    git($, state.root, ['log', '-10', '--format=%s']),
    git($, state.root, ['diff', '--cached', '--stat', '--no-color']),
    git($, state.root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--', '.', ...DIFF_EXCLUDES]),
  ])
  const text = diff?.stdout ?? ''
  const stop = new AbortController()
  generation = stop
  try {
    const reply = await $.model.complete(
      {
        model: prefs.commitModel,
        system: commitSystem(words, prefs.commitStyle),
        prompt: commitPrompt({
          recentSubjects: subjects?.exitCode === 0 ? subjects.stdout.split('\n').filter(s => s !== '') : [],
          stat: stat?.stdout ?? '',
          diff: text.slice(0, DIFF_LIMIT),
          isDiffCut: text.length > DIFF_LIMIT,
        }),
        maxTokens: 300,
        effort: 'low',
        timeoutMs: 45_000,
      },
      { signal: stop.signal },
    )
    if (!reply.isAnswered) {
      await note($, words.generateFailed(reply.reason))
      return
    }
    const { subject, body } = parseReply(reply.text)
    await update($, commit, d => (d === null ? d : { ...d, subject: subject || d.subject, body, busy: null, note: null }))
    $.ui.toast(words.generated(reply.usage.input_tokens + reply.usage.output_tokens))
  } catch (error) {
    await note($, words.generateFailed(error instanceof Error ? error.message : String(error)))
  } finally {
    if (generation === stop) generation = null
  }
}

/**
 * Whether the repository runs hooks of its own: then the commit goes through
 * the Bash tool, where they run. The engine turns hooks off for the mod's own
 * git (a `core.hooksPath` it sets on the command line), so only a hooks path a
 * config file sets counts, else the repository's own `hooks` folder.
 */
async function hasHooks($: EngineInterface, root: string): Promise<boolean> {
  const configured = await git($, root, ['config', '--show-origin', '--get-all', 'core.hooksPath'])
  const fromFiles =
    configured?.exitCode === 0
      ? configured.stdout
          .split('\n')
          .filter(line => line.startsWith('file:'))
          .map(line => line.split('\t')[1]?.trim() ?? '')
          .filter(path => path !== '')
      : []
  let dir = fromFiles.pop()
  if (dir !== undefined) {
    const home = (await $.env.get('HOME')) ?? ''
    if (dir.startsWith('~/')) dir = `${home}${dir.slice(1)}`
    else if (!dir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dir)) dir = `${root}/${dir}`
  } else {
    const common = await git($, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (common?.exitCode !== 0) return false
    dir = `${common.stdout.trim()}/hooks`
  }
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.some(entry => entry.kind !== 'dir' && !entry.name.endsWith('.sample'))
}

function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '')
      .pop() ?? ''
  )
}

/** Commits the staged files with the dialog's message, then closes it and says so. */
async function doCommit($: EngineInterface, options: PluginOptions): Promise<void> {
  const draft = await read($, commit)
  const state = lastGit
  const words = (await wordsOf($, options)).git
  if (draft === null || state === null || draft.busy !== null) return
  if (draft.subject.trim() === '') return note($, words.emptySubject)
  if (draft.files.length === 0) return note($, words.nothingStaged)
  await note($, null, 'committing')

  const located = await git($, state.root, ['rev-parse', '--path-format=absolute', '--git-path', 'MK_USAGE_MSG'])
  const messagePath = located?.exitCode === 0 ? located.stdout.trim() : ''
  if (messagePath === '') return note($, words.commitFailed('git rev-parse'))
  await $.fs.write(messagePath, messageOf(draft.subject, draft.body))

  const prefs = gitPrefsFrom(options)
  // A path with a quote or a `$` would need a shell's own escaping: those go direct.
  const isQuotable = !/["$`\\]/.test(state.root + messagePath) || /^[A-Za-z]:\\/.test(state.root)
  const via = prefs.commitVia === 'auto' ? ((await hasHooks($, state.root)) ? 'bash' : 'direct') : prefs.commitVia
  let failure: string | undefined
  if (via === 'bash' && isQuotable) {
    const command = `git -C "${state.root}" commit --cleanup=whitespace -F "${messagePath}"`
    const ran = await $.tool.call({
      tool: 'Bash',
      command,
      description: 'Commit the staged files with the message the user wrote in the mk-usage commit dialog',
      consent: `The user wrote a commit message in the mk-usage commit dialog and pressed "${words.confirm}" to run: ${command}`,
    })
    if ('deny' in ran && ran.deny !== undefined) failure = words.commitDenied
    else if ('isError' in ran && ran.isError === true) failure = lastLine(String(ran.text ?? '')) || 'git commit'
  } else {
    const ran = await git($, state.root, ['commit', '--cleanup=whitespace', '-F', messagePath], COMMIT_TIMEOUT_MS)
    if (ran === undefined) failure = 'git commit'
    else if (ran.exitCode !== 0) failure = lastLine(ran.stderr) || lastLine(ran.stdout) || `exit ${ran.exitCode}`
  }
  if (failure !== undefined) return note($, words.commitFailed(failure))

  const made = await git($, state.root, ['log', '-1', '--format=%h'])
  await update($, commit, () => null)
  isCommitOpen = false
  await $.ui.close({ id: COMMIT_PANE })
  $.ui.toast(words.committed(made?.stdout.trim() ?? '', draft.subject.trim()))
  await refreshGit($, options)
}

// ------------------------------------------------------------------ commands

type CommandWord = keyof Words['commandWords']

/** Whether `word` is the command word `key` in either language. */
function isCommandWord(word: string | undefined, key: CommandWord): boolean {
  if (word === undefined) return false
  const w = word.toLowerCase()
  return w === WORDS.es.commandWords[key] || w === WORDS.en.commandWords[key]
}

function usageWords(words: Words): string {
  const names = PLACEMENTS.map(p => words.placementNames[p]).join('|')
  const cw = words.commandWords
  return `${names}|${cw.git} ${names}|${cw.commit}|${cw.refresh}`
}

function rowElement(Text: ElementConstructor<TextProps>, row: Row): RenderElement {
  return (
    <Text wrap="truncate-end">
      {row.map(segment => (
        <Text {...styleOf(segment)}>{segment.text}</Text>
      ))}
    </Text>
  )
}

export const register: Register = (on, options) => {
  const configDefault = placementOf(options.placement) ?? 'footer'
  const gitDefault = placementOf(options.git_placement) ?? 'band'

  on('session.start', async ($, e, next) => {
    // The profile first: it names the account the stored figures belong to.
    try {
      await loadProfile($)
    } catch {
      // The figures are kept unkeyed and the detail goes without the plan.
    }
    try {
      await loadSaved($, configDefault, gitDefault)
    } catch {
      // Nothing saved yet.
    }
    try {
      const usage = await $.session.usage()
      await record($, usage.rateLimits)
    } catch {
      // No reading before the first response.
    }
    $.clock.every(TICK_MS, () => {
      void tick($, configDefault, gitDefault)
    })
    $.clock.every(gitPrefsFrom(options).refreshMs, () => {
      void gitTick($, options)
    })
    $.clock.every(GITHUB_TICK_MS, () => {
      void githubTick($, options)
    })
    try {
      const words = await wordsOf($, options)
      await $.command.register({
        name: 'mk-usage',
        description: words.commandDescription,
        argumentHint: `[${usageWords(words)}]`,
        immediate: true,
      })
    } catch {
      // The line works without the command.
    }
    // git before the first prompt; GitHub, slower, on a timer of its own.
    await refreshGit($, options)
    $.clock.after(0, () => {
      void githubTick($, options)
    })
    // A site may have been drawn before the state above was loaded.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // /clear, /resume and /branch reset $.state and do not raise session.start again.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      try {
        await loadProfile($)
        await loadSaved($, configDefault, gitDefault)
      } catch {
        // The next tick or measurement fills it in.
      }
      githubDueAt = 0
      await refreshGit($, options)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.CwdChanged', async ($, e, next) => {
    githubDueAt = 0
    await refreshGit($, options)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      try {
        await record($, e.rateLimits)
      } catch {
        // The line keeps the last reading.
      }
    }
    return next(e)
  })

  // A tool that may have changed files reads the repository again once it
  // ran; a push or a pull request command asks GitHub too.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      if (TOOLS_THAT_CHANGE_FILES.has(tool)) {
        // On a timer of its own: the tool's result is not held for it.
        $.clock.after(0, () => {
          void refreshGit($, options)
        })
        if (tool === 'Bash') {
          const operation = (ran as { result?: { gitOperation?: { push?: unknown; pr?: unknown } } }).result?.gitOperation
          const command = String((e as { command?: unknown }).command ?? '')
          if (operation?.push !== undefined || operation?.pr !== undefined || /\bgit\s+push\b|\bgh\s+(pr|run)\b/.test(command)) {
            askGitHubSoon($, options)
          }
        }
      }
    } catch {
      // The row catches up on its next tick.
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      $.clock.after(0, () => {
        void refreshGit($, options)
      })
    }
    return next(e)
  })

  // Under the prompt: the quota by default, git when moved there; the engine
  // draws that line in its own gray, after whatever tail another plugin added.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const isUsageHere = (await read($, placement)) === 'footer'
    const isGitHere = (await read($, gitPlacement)) === 'footer'
    if (!isUsageHere && !isGitHere) return next(e)
    // `hint` is only part of the line: the engine also draws its indent, the
    // mode pill and the separator before the tail (`  ⏵⏵ auto mode on ` … ` · `,
    // 21 columns), and the `· ← for agents` pill (15 more) whether or not `hint`
    // carries it. Measured on 2.1.296; 3 columns of margin.
    // The engine's PR badge (`PR #12 · `) sits on the line too, outside `hint`:
    // known here when GitHub said the branch has an open pull request.
    const gitView = await gitViewOf($, options)
    const pr = gitView?.github?.root === gitView?.git.root && gitView?.github?.branch === gitView?.git.branch ? gitView?.github?.pr : null
    const badge = pr?.state === 'open' && !e.props.hint.includes(`#${pr.number}`) ? `PR #${pr.number} · `.length : 0
    const engineDraws = (e.props.hint.includes('←') ? 21 : 36) + badge
    const theirs = e.props.tail ?? ''
    let room = (e.viewport?.columns ?? 80) - e.props.hint.length - engineDraws - 3 - (theirs === '' ? 0 : theirs.length + 3)
    const parts: string[] = []
    if (isUsageHere) {
      const view = await viewOf($, options)
      const text = view === null ? '' : textOf(fitLine(view, room, 'footer'))
      if (text !== '') {
        parts.push(text)
        room -= text.length + 3
      }
    }
    if (isGitHere && room >= MIN_FOOTER_GIT) {
      const text = gitView === null ? '' : textOf(fitGitLine(gitView, room, 'footer'))
      if (text !== '' && text.length <= room) parts.push(text)
    }
    if (parts.length === 0) return next(e)
    const tail = [theirs, ...parts].filter(part => part !== '').join(' │ ')
    return next({ ...e, props: { ...e.props, tail } })
  })

  // Above the prompt: git by default, one row colored by state with the
  // commit button at its end; the quota when moved there, in the theme's colors.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const isUsageHere = (await read($, placement)) === 'band'
    const isGitHere = (await read($, gitPlacement)) === 'band'
    if (!isUsageHere && !isGitHere) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const rows: RenderElement[] = []
    if (isGitHere) {
      const view = await gitViewOf($, options)
      if (view !== null) {
        const offersCommit = canCommit(view.git) && !e.props.isWorking && columns >= MIN_BAND_FOR_BUTTON
        const row = fitGitLine(view, offersCommit ? columns - COMMIT_BUTTON_COLUMNS : columns)
        rows.push(
          <Box flexDirection="row">
            <Box flexGrow={1}>{rowElement(Text, row)}</Box>
            {offersCommit ? (
              <Button key="mk-usage-commit" plain hotkey="c" label={view.words.commitButton} onPress={() => void openCommit($, options)} />
            ) : null}
          </Box>,
        )
      }
    }
    if (isUsageHere) {
      const view = await viewOf($, options)
      const row = view === null ? [] : fitLine(view, columns)
      if (row.length > 0) rows.push(rowElement(Text, row))
    }
    if (rows.length === 0) return next(e)
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        {rows}
        {theirs}
      </Box>
    )
  })

  // The detail, only while the person keeps the pane `/mk-usage` opened.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = await viewOf($, options)
    const words = await wordsOf($, options)
    const rows: Row[] = view === null ? [[{ text: words.noData, tone: 'muted' }]] : detailRows(view)
    const gitView = await gitViewOf($, options)
    const gitRows = gitView === null ? [] : gitDetailRows(gitView)

    return (
      <Box flexDirection="column">
        {rows.map(row => rowElement(Text, row))}
        {gitRows.length > 0 ? <Text> </Text> : null}
        {gitRows.map(row => rowElement(Text, row))}
        <Text color="inactive">{words.escCloses}</Text>
      </Box>
    )
  })

  // The commit dialog: the staged files, the message, and what to do with it.
  on('ui.render', { component: 'Pane', requestId: COMMIT_PANE }, async ($, e) => {
    const words = (await wordsOf($, options)).git
    // The mobile app has no text field: the dialog is the terminal's and the desktop's.
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text color="inactive">{words.commitIn('')}</Text>
    }
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const draft = await read($, commit)
    const state = await read($, repo)
    const prefs = gitPrefsFrom(options)
    if (draft === null || state === null) return <Text color="inactive">{words.notRepo}</Text>
    const branch = state.branch ?? words.detached
    const head = [words.commitIn(branch), words.stagedFiles(draft.files.length)]
    if (draft.unstaged > 0) head.push(words.unstagedLeft(draft.unstaged))
    const listed = draft.files.slice(0, LISTED_FILES)
    const busy = draft.busy === 'generating' ? words.generating : draft.busy === 'committing' ? words.committing : null
    const setSubject = (value: string) => void update($, commit, d => (d === null ? d : { ...d, subject: value }))
    const setBody = (value: string) => void update($, commit, d => (d === null ? d : { ...d, body: value }))
    const confirm = () => void doCommit($, options)
    // Enter submits what the field holds then: kept, so a failed commit keeps it.
    const submitSubject = (value: string) => void update($, commit, d => (d === null ? d : { ...d, subject: value })).then(confirm)
    const submitBody = (value: string) => void update($, commit, d => (d === null ? d : { ...d, body: value })).then(confirm)

    return (
      <Box flexDirection="column">
        <Text bold>{head.join(' · ')}</Text>
        {e.props.isFocused ? null : <Text color="suggestion">{words.focusHint}</Text>}
        {listed.map(file => (
          <Text color="inactive" wrap="truncate-end">{`  ${file.status} ${file.path}`}</Text>
        ))}
        {draft.files.length > listed.length ? <Text color="inactive">{`  ${words.moreFiles(draft.files.length - listed.length)}`}</Text> : null}
        {draft.files.length === 0 ? <Text color="warning">{words.nothingStaged}</Text> : null}
        {draft.unstaged > 0 ? <Button key="stage-all" label={words.stageAll} onPress={() => void stageAll($, options)} /> : null}
        <Input key="subject" label={words.subject} value={draft.subject} autoFocus submitLabel={words.confirm} onInput={setSubject} onSubmit={submitSubject} />
        <Input key="body" label={words.body} value={draft.body} submitLabel={words.confirm} onInput={setBody} onSubmit={submitBody} />
        <Box flexDirection="row">
          <Button key="confirm" variant="primary" label={words.confirm} onPress={confirm} />
          {prefs.commitAi ? <Text> </Text> : null}
          {prefs.commitAi ? <Button key="generate" label={words.generate} onPress={() => void generateMessage($, options)} /> : null}
          <Text> </Text>
          <Button key="cancel" role="dismiss" label={words.cancel} onPress={() => void $.ui.close({ id: COMMIT_PANE })} />
        </Box>
        {busy !== null ? <Text color="suggestion">{busy}</Text> : null}
        {draft.note !== null ? <Text color="error">{draft.note}</Text> : null}
      </Box>
    )
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) isDetailOpen = false
    if (e.id === COMMIT_PANE) {
      isCommitOpen = false
      generation?.abort()
      generation = null
      await update($, commit, () => null)
    }
    return result
  })

  on('command.run', { command: 'mk-usage' }, async ($, e) => {
    const words = await wordsOf($, options)
    const asked = e.args.trim()
    const [first, ...rest] = asked.split(/\s+/)
    if (asked === '' || isCommandWord(first, 'detail')) {
      isDetailOpen = true
      await refreshGit($, options)
      await $.ui.open({ id: PANE, title: 'mk-usage', focus: true, closeOnEscape: true })
      return {}
    }
    if (isCommandWord(first, 'commit')) {
      await openCommit($, options)
      return {}
    }
    if (isCommandWord(first, 'refresh')) {
      githubBlocked.clear()
      githubFailures = 0
      await refreshGit($, options)
      await refreshGitHub($, options)
      $.ui.toast(words.git.refreshed)
      return {}
    }
    if (isCommandWord(first, 'git')) {
      const chosen = placementOf(rest.join(' '))
      if (chosen === undefined) {
        $.ui.toast(words.usage(usageWords(words)))
        return {}
      }
      gitShownAt = chosen
      await update($, gitPlacement, () => chosen)
      const choice: PlacementChoice = { value: chosen, configDefault: gitDefault }
      await $.store.set('gitPlacement', choice)
      $.ui.toast(words.git.movedTo[chosen])
      if (chosen !== 'hidden') await refreshGit($, options)
      return {}
    }
    const chosen = placementOf(asked)
    if (chosen === undefined) {
      $.ui.toast(words.usage(usageWords(words)))
      return {}
    }
    await update($, placement, () => chosen)
    const choice: PlacementChoice = { value: chosen, configDefault }
    await $.store.set('placement', choice)
    $.ui.toast(words.movedTo[chosen])
    return {}
  })
}
