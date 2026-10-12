import { describe, expect, test } from 'claude-code/testing'

import type { GitHubState, GitState } from '../types'
import {
  DEFAULT_GIT_PREFS,
  canCommit,
  checksOf,
  fitGitLine,
  gitDetailRows,
  gitPrefsFrom,
  hostOf,
  isGitHubRemote,
  isNewerVersion,
  parseDescribe,
  parseLastCommit,
  parsePullRequest,
  parseRemotes,
  parseRuns,
  parseStatus,
  versionOf,
} from '../hooks/git'
import type { GitView } from '../hooks/git'
import { textOf } from '../hooks/usage'
import { WORDS } from '../hooks/words'

const NOW = Date.UTC(2026, 9, 12, 18, 0)
const OID = 'd147025b9985b954f677e0797c51107bd4762fb5'

/** What `git status --porcelain=v2 --branch --show-stash -z` printed in a scratch repository. */
const STATUS = [
  `# branch.oid ${OID}`,
  '# branch.head feat/git',
  '# branch.upstream origin/feat/git',
  '# branch.ab +2 -0',
  '# stash 1',
  '1 AM N... 000000 100644 100644 0000000000000000000000000000000000000000 0505b3b1df17e3fedbe98668cf073a564921556 b.txt',
  '2 R. N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 R100 c.txt',
  'a.txt',
  '1 .M N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 hooks/x.ts',
  '? new.txt',
  '',
].join('\0')

function state(overrides: Partial<GitState> = {}): GitState {
  return {
    root: '/work/app',
    branch: 'feat/git',
    oid: OID,
    upstream: 'origin/feat/git',
    ahead: 0,
    behind: 0,
    unpushed: null,
    remotes: ['git@github.com:acme/app.git'],
    files: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
    stash: 0,
    operation: null,
    tag: 'v0.3.0',
    sinceTag: 0,
    changelogTouched: true,
    version: '0.3.0',
    lastCommit: { hash: 'd147025', subject: 'feat: algo', at: NOW - 5 * 60_000 },
    isSlow: false,
    at: NOW,
    ...overrides,
  }
}

function hub(overrides: Partial<GitHubState> = {}): GitHubState {
  return { root: '/work/app', branch: 'feat/git', pr: null, checks: [], checksSha: OID, unavailable: null, at: NOW, ...overrides }
}

function view(git: GitState, github: GitHubState | null = null, language: 'es' | 'en' = 'es'): GitView {
  return { git, github, words: WORDS[language].git, prefs: DEFAULT_GIT_PREFS, now: NOW }
}

const OK_CHECKS = [
  { name: 'Validar y probar', state: 'ok' as const },
  { name: 'Lint', state: 'ok' as const },
]

describe('what git prints', () => {
  test('porcelain v2: branch, upstream, ahead and behind, stash, and every kind of entry', () => {
    const status = parseStatus(STATUS)
    expect(status).toEqual({
      branch: 'feat/git',
      oid: OID,
      upstream: 'origin/feat/git',
      ahead: 2,
      behind: 0,
      stash: 1,
      // b.txt staged and modified, c.txt renamed (its old name skipped), hooks/x.ts modified.
      files: { staged: 2, modified: 2, untracked: 1, conflicts: 0 },
    })
  })

  test('a detached HEAD, a repository with no commits, and a conflict', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0').oid).toBeNull()
    const detached = parseStatus(`# branch.oid ${OID}\0# branch.head (detached)\0u UU N... 1 2 3 4 a b c f.txt\0`)
    expect(detached.branch).toBeNull()
    expect(detached.files.conflicts).toBe(1)
  })

  test('describe: the tag and the commits after it, dashes in the tag included', () => {
    expect(parseDescribe('v0.3.0-4-gabc1234\n')).toEqual({ tag: 'v0.3.0', since: 4 })
    expect(parseDescribe('v0.4.0-beta.1-0-g1a2b3c4')).toEqual({ tag: 'v0.4.0-beta.1', since: 0 })
    expect(parseDescribe('')).toBeUndefined()
  })

  test('remotes, their hosts, and which are on GitHub', () => {
    expect(parseRemotes('remote.origin.url https://github.com/acme/app.git\nremote.mirror.url git@gitlab.com:acme/app.git\n')).toEqual([
      'https://github.com/acme/app.git',
      'git@gitlab.com:acme/app.git',
    ])
    expect(hostOf('git@github.com:acme/app.git')).toBe('github.com')
    expect(hostOf('ssh://git@github.com/acme/app.git')).toBe('github.com')
    expect(hostOf('https://user@GitHub.com/acme/app')).toBe('github.com')
    expect(isGitHubRemote('git@gitlab.com:acme/app.git')).toBe(false)
    expect(isGitHubRemote('https://git.acme.dev/x/y.git', 'git.acme.dev')).toBe(true)
  })

  test('the last commit, a manifest\'s version, and which version is newer', () => {
    expect(parseLastCommit('d147025\x001760292000\x00feat: algo\n')).toEqual({ hash: 'd147025', at: 1760292000000, subject: 'feat: algo' })
    expect(parseLastCommit('')).toBeNull()
    expect(versionOf('{"name":"x","version":"0.4.0"}')).toBe('0.4.0')
    expect(versionOf('not json')).toBeNull()
    expect(isNewerVersion('0.4.0', 'v0.3.0')).toBe(true)
    expect(isNewerVersion('0.3.0', 'v0.3.0')).toBe(false)
    expect(isNewerVersion('0.3.0', null)).toBe(true)
  })
})

describe('what gh prints', () => {
  test('a pull request with check runs and commit statuses', () => {
    const found = parsePullRequest(
      JSON.stringify({
        number: 2,
        title: 'Git en la franja',
        url: 'https://github.com/acme/app/pull/2',
        state: 'OPEN',
        isDraft: false,
        headRefOid: OID,
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'Validar y probar', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://x/1' },
          { __typename: 'CheckRun', name: 'Publicar', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', name: 'Lint', status: 'IN_PROGRESS', conclusion: '' },
          { __typename: 'StatusContext', context: 'deploy', state: 'FAILURE', targetUrl: 'https://x/2' },
        ],
      }),
    )
    expect(found?.pr).toEqual({ number: 2, title: 'Git en la franja', url: 'https://github.com/acme/app/pull/2', state: 'open', isDraft: false })
    expect(found?.sha).toBe(OID)
    expect(found?.checks.map(c => [c.name, c.state])).toEqual([
      ['Validar y probar', 'ok'],
      ['Publicar', 'skipped'],
      ['Lint', 'running'],
      ['deploy', 'failed'],
    ])
  })

  test('workflow runs: only the newest commit\'s, one per workflow', () => {
    const runs = parseRuns(
      JSON.stringify([
        { status: 'in_progress', conclusion: '', workflowName: 'CI', headSha: 'new', url: 'u1' },
        { status: 'completed', conclusion: 'failure', workflowName: 'CI', headSha: 'old', url: 'u2' },
        { status: 'completed', conclusion: 'success', workflowName: 'Pages', headSha: 'new', url: 'u3' },
      ]),
    )
    expect(runs.sha).toBe('new')
    expect(runs.checks.map(c => [c.name, c.state])).toEqual([
      ['CI', 'running'],
      ['Pages', 'ok'],
    ])
    expect(parseRuns('[]')).toEqual({ checks: [], sha: null })
    expect(checksOf(undefined)).toEqual([])
  })
})

describe('preferences', () => {
  test('defaults, and an empty changelog turns its warning off', () => {
    expect(gitPrefsFrom({})).toEqual(DEFAULT_GIT_PREFS)
    const set = gitPrefsFrom({
      git_refresh_seconds: 60,
      git_github: 'off',
      git_github_minutes: 10,
      git_changelog_file: '',
      git_tag_pattern: 'release-*',
      git_commit_style: 'plain',
      git_commit_ai: false,
      git_commit_model: 'sonnet',
      git_commit_via: 'bash',
    })
    expect(set).toEqual({
      refreshMs: 60_000,
      github: false,
      githubEveryMs: 600_000,
      changelogFile: null,
      tagPattern: 'release-*',
      commitStyle: 'plain',
      commitAi: false,
      commitModel: 'sonnet',
      commitVia: 'bash',
    })
    expect(gitPrefsFrom({ git_refresh_seconds: 1 }).refreshMs).toBe(20_000)
  })
})

describe('the row', () => {
  test('everything at once: changes, sync, CI, version and the changelog, the branch in the worst tone', () => {
    const git = state({
      files: { staged: 2, modified: 3, untracked: 1, conflicts: 0 },
      ahead: 2,
      sinceTag: 4,
      changelogTouched: false,
    })
    const row = fitGitLine(view(git, hub({ checks: OK_CHECKS })), 200)
    expect(textOf(row)).toBe(
      'feat/git  │  2 preparados · 3 modificados · 1 nuevo  │  subir 2  │  CI ok  │  v0.3.0 +4 sin publicar · CHANGELOG sin tocar',
    )
    const tones = Object.fromEntries(row.filter(s => s.text.trim() !== '│' && s.text !== ' · ').map(s => [s.text, s.tone]))
    expect(tones).toEqual({
      'feat/git': 'warn',
      '2 preparados': 'warn',
      '3 modificados': 'warn',
      '1 nuevo': 'muted',
      'subir 2': 'warn',
      'CI ok': 'ok',
      'v0.3.0 +4 sin publicar': 'muted',
      'CHANGELOG sin tocar': 'warn',
    })
    expect(row[0]?.isBold).toBe(true)
  })

  test('clean and up to date reads green', () => {
    const row = fitGitLine(view(state({ branch: 'master' }), hub({ branch: 'master', checks: OK_CHECKS })), 200)
    expect(textOf(row)).toBe('master  │  limpio  │  al día  │  CI ok  │  v0.3.0')
    expect(row[0]?.tone).toBe('ok')
  })

  test('the states that call for attention: conflicts, divergence, failing CI, a rebase', () => {
    const conflicted = fitGitLine(view(state({ files: { staged: 0, modified: 0, untracked: 0, conflicts: 2 }, operation: 'merge' })), 200)
    expect(textOf(conflicted)).toContain('merge en curso · 2 en conflicto')
    expect(conflicted[0]?.tone).toBe('bad')
    const diverged = fitGitLine(view(state({ ahead: 1, behind: 3 })), 200)
    expect(textOf(diverged)).toContain('subir 1 · bajar 3')
    expect(diverged[0]?.tone).toBe('bad')
    const failing = fitGitLine(view(state(), hub({ checks: [...OK_CHECKS, { name: 'deploy', state: 'failed' }] })), 200)
    expect(textOf(failing)).toContain('CI falla 1/3')
    expect(failing[0]?.tone).toBe('bad')
  })

  test('running checks are news, not trouble; checks of an older commit are muted', () => {
    const running = fitGitLine(view(state(), hub({ checks: [{ name: 'CI', state: 'running' }] })), 200)
    expect(running.find(s => s.text === 'CI corriendo 1/1')?.tone).toBe('info')
    const older = fitGitLine(view(state({ ahead: 1 }), hub({ checks: OK_CHECKS, checksSha: 'abc' })), 200)
    expect(older.find(s => s.text === 'CI ok')?.tone).toBe('muted')
  })

  test('a merged pull request, a release waiting for CI, a branch never pushed, no remote', () => {
    const merged = fitGitLine(
      view(state(), hub({ pr: { number: 2, title: 't', url: 'u', state: 'merged', isDraft: false }, checks: OK_CHECKS })),
      200,
    )
    expect(merged.find(s => s.text === 'PR fusionado')?.tone).toBe('merged')
    const pending = fitGitLine(view(state({ version: '0.4.0' })), 200)
    expect(pending.find(s => s.text === 'v0.4.0 pendiente')?.tone).toBe('info')
    expect(textOf(fitGitLine(view(state({ upstream: null, unpushed: 3 })), 200))).toContain('3 sin subir')
    expect(textOf(fitGitLine(view(state({ upstream: null, unpushed: 0 })), 200))).toContain('rama sin subir')
    expect(textOf(fitGitLine(view(state({ remotes: [], upstream: null })), 200))).toContain('sin remoto')
  })

  test('narrower, it sums, shortens and drops, keeping what calls for attention', () => {
    const git = state({
      branch: 'feat/una-rama-con-nombre-largo',
      files: { staged: 2, modified: 3, untracked: 1, conflicts: 1 },
      ahead: 2,
      sinceTag: 4,
      changelogTouched: false,
      stash: 2,
    })
    const v = view(git, hub({ branch: git.branch, checks: [{ name: 'CI', state: 'failed' }] }))
    const widths = [160, 120, 100, 90, 80, 70, 60, 50, 40, 30, 20]
    for (const width of widths) {
      const text = textOf(fitGitLine(v, width))
      expect(text.length).toBeLessThanOrEqual(width)
      expect(text).not.toMatch(/[…↑↓→↻]/)
    }
    expect(textOf(fitGitLine(v, 120))).toContain('5 cambios')
    expect(textOf(fitGitLine(v, 120))).toContain('1 en conflicto')
    expect(textOf(fitGitLine(v, 70))).toBe('feat/una-rama-con-nombre-largo 1 en conflicto · CI falla · 5 cambios')
    expect(textOf(fitGitLine(v, 20))).toBe('fea.. 1 en conflicto')
  })

  test('English', () => {
    const git = state({ files: { staged: 1, modified: 0, untracked: 0, conflicts: 0 }, ahead: 1 })
    expect(textOf(fitGitLine(view(git, hub({ checks: OK_CHECKS }), 'en'), 200))).toBe(
      'feat/git  │  1 staged  │  1 to push  │  CI ok  │  v0.3.0',
    )
  })

  test('the commit button shows for changes to commit, not mid-conflict', () => {
    expect(canCommit(state({ files: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }))).toBe(true)
    expect(canCommit(state())).toBe(false)
    expect(canCommit(state({ files: { staged: 1, modified: 0, untracked: 0, conflicts: 1 } }))).toBe(false)
  })
})

describe('the detail', () => {
  test('git, then GitHub with the pull request and the checks that need a look', () => {
    const git = state({ files: { staged: 1, modified: 0, untracked: 0, conflicts: 0 }, ahead: 1, sinceTag: 2, changelogTouched: false, version: '0.4.0' })
    const github = hub({
      pr: { number: 2, title: 'Git en la franja', url: 'https://github.com/acme/app/pull/2', state: 'open', isDraft: true },
      checks: [...OK_CHECKS, { name: 'deploy', state: 'failed' }],
    })
    const rows = gitDetailRows(view(git, github)).map(textOf)
    expect(rows).toEqual([
      'Git · app · feat/git',
      '  sigue a origin/feat/git · subir 1',
      '  1 preparado',
      '  último commit d147025 hace 5m: feat: algo',
      '  v0.3.0 · 2 commits sin publicar · v0.4.0 pendiente · CHANGELOG.md sin tocar desde v0.3.0',
      'GitHub',
      '  PR #2: Git en la franja (borrador)',
      '  checks de d147025: 2 ok, 1 falla',
      '    falla  deploy',
      '  https://github.com/acme/app/pull/2',
    ])
  })

  test('why GitHub says nothing', () => {
    const rows = gitDetailRows(view(state(), hub({ unavailable: 'gh-missing' }))).map(textOf)
    expect(rows.slice(-2)).toEqual(['GitHub', '  GitHub: instalá gh para ver PR y CI'])
  })
})
