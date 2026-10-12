import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Reading } from '../types'

const MINUTE = 60_000
const NOW = Date.UTC(2026, 9, 12, 18, 0)
const ROOT = '/work/app'
const OID = 'd147025b9985b954f677e0797c51107bd4762fb5'
const PROMPT = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 140 } }

const READING: Reading = {
  at: NOW - MINUTE,
  limits: [{ kind: 'five_hour', percentUsed: 52, resetsAt: new Date(NOW + 133 * MINUTE).toISOString() }],
}

/** A repository on `feat/git`: two files staged, one modified, one commit to push, four since v0.3.0. */
const STATUS = [
  `# branch.oid ${OID}`,
  '# branch.head feat/git',
  '# branch.upstream origin/feat/git',
  '# branch.ab +1 -0',
  '1 M. N... 100644 100644 100644 a a hooks/git.ts',
  '1 A. N... 000000 100644 100644 a a hooks/commit.ts',
  '1 .M N... 100644 100644 100644 a a README.md',
  '',
].join('\0')

const PR = JSON.stringify({
  number: 2,
  title: 'Git en la franja',
  url: 'https://github.com/acme/app/pull/2',
  state: 'OPEN',
  isDraft: false,
  headRefOid: OID,
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'Validar y probar', status: 'COMPLETED', conclusion: 'SUCCESS' }],
})

type World = {
  isRepo?: boolean
  gh?: 'pr' | 'missing' | 'none'
  hooks?: string[]
}

type Calls = { argv: string[][]; writes: { path: string; text: string }[]; model: number; toasts: string[]; opened: string[]; closed: string[] }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const exit = (exitCode: number, stderr = '') => ({ value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** The world beneath the mod: git and gh answering from a fixed repository, the files, the model. */
async function start($: Engine, on: On, world: World = {}): Promise<Calls> {
  const calls: Calls = { argv: [], writes: [], model: 0, toasts: [], opened: [], closed: [] }
  const { isRepo = true, gh = 'pr', hooks = [] } = world
  mock.clock(on, { now: NOW })
  mock.store(on, { reading: READING })
  mock.env(on, { HOME: '/home/test', LANG: 'es_AR.UTF-8' })
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', ($, e) => {
    if (e.path === `${ROOT}/.claude-plugin/plugin.json`) return { value: '{"name":"app","version":"0.3.0"}' }
    return { deny: `no file ${e.path}` }
  })
  on('fs.exists', ($, e) => ({ value: e.path === `${ROOT}/CHANGELOG.md` }))
  on('fs.write', ($, e) => {
    calls.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('fs.list', () => ({ value: hooks.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    calls.argv.push(argv)
    const [cmd, ...args] = argv
    const sub = args[0]
    if (cmd === 'date') return ok('-0300\n')
    if (cmd === 'gh') {
      if (gh === 'missing') return { deny: 'gh: not found' }
      if (sub === 'pr') return gh === 'pr' ? ok(PR) : exit(1, 'no pull requests found')
      return ok('[]')
    }
    if (cmd !== 'git') return exit(127)
    if (!isRepo) return exit(128, 'not a git repository')
    if (sub === 'rev-parse') {
      if (args.includes('MK_USAGE_MSG')) return ok(`${ROOT}/.git/MK_USAGE_MSG\n`)
      if (args.includes('hooks')) return ok(`${ROOT}/.git/hooks\n`)
      const paths = args.filter((_, i) => args[i - 1] === '--git-path').map(p => `${ROOT}/.git/${p}`)
      return ok(`${[ROOT, ...paths].join('\n')}\n`)
    }
    if (args.includes('status')) return ok(STATUS)
    if (sub === 'config' && args[1] === '--get-regexp') return ok('remote.origin.url git@github.com:acme/app.git\n')
    if (sub === 'config') return exit(1)
    if (sub === 'describe') return ok('v0.3.0-4-gd147025\n')
    if (sub === 'log' && args.includes('-10')) return ok('feat: uno\nfix: dos\n')
    if (sub === 'log' && args.includes('--format=%h')) return ok('e5f6a7b\n')
    if (sub === 'log') return ok(`d147025\x00${Math.floor((NOW - 5 * MINUTE) / 1000)}\x00feat: algo\n`)
    if (sub === 'diff' && args.includes('--quiet')) return exit(0)
    if (sub === 'diff' && args.includes('--name-status')) return ok('M\0hooks/git.ts\0A\0hooks/commit.ts\0')
    if (sub === 'diff') return ok('+algo\n')
    if (sub === 'commit') return ok('[feat/git e5f6a7b] feat(hooks): algo\n')
    return exit(1)
  })
  on('model.complete', () => {
    calls.model += 1
    return {
      value: {
        isAnswered: true as const,
        text: 'feat(hooks): mostrar git en la franja\n\nSuma la rama, los cambios y el CI.',
        usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  on('command.register', () => ({ value: { command: 'mk-usage' } }))
  on('ui.toast', ($, e) => {
    calls.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    calls.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    calls.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint + (e.props.tail ?? '')}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  // The first read of git and GitHub runs beside the session's start.
  await $.command.run({ command: 'mk-usage', args: 'actualizar', ...PROMPT })
  return calls
}

function band(columns: number, isWorking = false) {
  return {
    plugin: 'mk-usage',
    surface: 'terminal' as const,
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
    viewport: { columns: columns + 5, rows: 40 },
  }
}

function hint(columns: number) {
  return {
    plugin: 'mk-usage',
    surface: 'terminal' as const,
    component: 'PromptHint' as const,
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns, rows: 40 },
  }
}

function pane(id: string) {
  return {
    plugin: 'mk-usage',
    surface: 'terminal' as const,
    component: 'Pane' as const,
    requestId: id,
    props: { title: id, isFocused: true, bodyColumns: 100, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 16 }, view: {} },
    viewport: { columns: 120, rows: 40 },
  }
}

async function gitRow($: Engine, columns: number, isWorking = false) {
  const ui = await $.ui.mount(band(columns, isWorking))
  const row = await ui.find({ type: 'Text', text: /feat\/git/ })
  const parts = await ui.findAll({ type: 'Text' })
  const button = await ui.find({ type: 'Button' })
  await ui.unmount()
  return { text: row?.text, parts: parts.map(p => ({ text: p.text, color: p.props.color, bold: p.props.bold })), button }
}

describe('git above the prompt (default)', () => {
  test('one row colored by state, the quota still under the prompt, the commit button at its end', async ($, on) => {
    await start($, on)
    const { text, parts, button } = await gitRow($, 160)
    // CHANGELOG.md has not changed since v0.3.0 (`git diff --quiet` exits 0) though four commits came after.
    expect(text).toBe('feat/git  │  2 preparados · 1 modificado  │  subir 1  │  CI ok  │  v0.3.0 +4 sin publicar · CHANGELOG sin tocar')
    expect(parts).toContainEqual({ text: 'feat/git', color: 'warning', bold: true })
    expect(parts).toContainEqual({ text: 'CI ok', color: 'success', bold: undefined })
    expect(parts).toContainEqual({ text: 'v0.3.0 +4 sin publicar', color: 'inactive', bold: undefined })
    expect(parts).toContainEqual({ text: 'CHANGELOG sin tocar', color: 'warning', bold: undefined })
    expect(button?.props).toMatchObject({ hotkey: 'c', label: 'commit', plain: true })
    const ui = await $.ui.mount(hint(140))
    expect((await ui.find({ type: 'Text' }))?.text).toContain('Sesión 5h 52%')
    expect((await ui.find({ type: 'Text' }))?.text).not.toContain('feat/git')
    await ui.unmount()
  })

  test('no commit button while Claude works, nor in a narrow band', async ($, on) => {
    await start($, on)
    expect((await gitRow($, 160, true)).button).toBeUndefined()
    expect((await gitRow($, 50)).button).toBeUndefined()
  })

  test('outside a repository there is no row', async ($, on) => {
    await start($, on, { isRepo: false })
    expect((await gitRow($, 160)).text).toBeUndefined()
  })

  test('without gh the row goes on without CI, and the detail says why', async ($, on) => {
    await start($, on, { gh: 'missing' })
    expect((await gitRow($, 160)).text).toBe('feat/git  │  2 preparados · 1 modificado  │  subir 1  │  v0.3.0 +4 sin publicar · CHANGELOG sin tocar')
    await $.command.run({ command: 'mk-usage', args: '', ...PROMPT })
    const ui = await $.ui.mount(pane('mk-usage'))
    expect(await ui.find({ type: 'Text', text: /instalá gh para ver PR y CI/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Git · app · feat\/git/ })).toBeDefined()
    await ui.unmount()
  })

  test('/mk-usage git pie moves it under the prompt, after the quota', async ($, on) => {
    await start($, on)
    expect(await $.command.run({ command: 'mk-usage', args: 'git pie', ...PROMPT })).toEqual({})
    expect((await gitRow($, 160)).text).toBeUndefined()
    const ui = await $.ui.mount(hint(200))
    expect((await ui.find({ type: 'Text' }))?.text).toMatch(/^\? for shortcutsSesión 5h 52%.* │ feat\/git │ /)
    await ui.unmount()
  })
})

describe('the commit dialog', () => {
  test('a draft from the staged files, committed with the message, no tokens spent', async ($, on) => {
    const calls = await start($, on)
    await $.command.run({ command: 'mk-usage', args: 'commit', ...PROMPT })
    expect(calls.opened).toContain('mk-usage-commit')
    const ui = await $.ui.mount(pane('mk-usage-commit'))
    expect((await ui.find({ type: 'Input', key: 'subject' }))?.props.value).toBe('feat(hooks): actualizar 2 archivos')
    expect(await ui.find({ type: 'Text', text: /Commit en feat\/git · 2 archivos preparados · 1 sin preparar/ })).toBeDefined()
    await ui.input({ key: 'subject', text: 'feat(hooks): git en la franja', kind: 'change' })
    await ui.press({ key: 'confirm' })
    await ui.unmount()
    expect(calls.writes).toEqual([{ path: `${ROOT}/.git/MK_USAGE_MSG`, text: 'feat(hooks): git en la franja\n' }])
    expect(calls.argv).toContainEqual(['git', 'commit', '--cleanup=whitespace', '-F', `${ROOT}/.git/MK_USAGE_MSG`])
    expect(calls.toasts).toContain('Commit e5f6a7b: feat(hooks): git en la franja')
    expect(calls.closed).toContain('mk-usage-commit')
    expect(calls.model).toBe(0)
  })

  test('"Generar con Claude" is the one place the model is called', async ($, on) => {
    const calls = await start($, on)
    await gitRow($, 160)
    await $.command.run({ command: 'mk-usage', args: 'commit', ...PROMPT })
    expect(calls.model).toBe(0)
    const ui = await $.ui.mount(pane('mk-usage-commit'))
    await ui.press({ key: 'generate' })
    expect(calls.model).toBe(1)
    expect((await ui.find({ type: 'Input', key: 'subject' }))?.props.value).toBe('feat(hooks): mostrar git en la franja')
    expect((await ui.find({ type: 'Input', key: 'body' }))?.props.value).toBe('Suma la rama, los cambios y el CI.')
    expect(calls.toasts).toContain('Mensaje de Claude (940 tokens)')
    await ui.unmount()
  })

  test('an empty subject is not committed', async ($, on) => {
    const calls = await start($, on)
    await $.command.run({ command: 'mk-usage', args: 'commit', ...PROMPT })
    const ui = await $.ui.mount(pane('mk-usage-commit'))
    await ui.input({ key: 'subject', text: '', kind: 'change' })
    await ui.press({ key: 'confirm' })
    expect(await ui.find({ type: 'Text', text: 'Falta el título.' })).toBeDefined()
    await ui.unmount()
    expect(calls.argv.some(a => a[1] === 'commit')).toBe(false)
  })
})
