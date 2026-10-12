import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Reading } from '../types'

const MINUTE = 60_000
// Monday 12 Oct 2026, 15:00 at UTC-3.
const NOW = Date.UTC(2026, 9, 12, 18, 0)
const SURFACES = ['terminal', 'desktop'] as const
const PROMPT = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const READING: Reading = {
  at: NOW - MINUTE,
  limits: [
    { kind: 'five_hour', percentUsed: 52, resetsAt: new Date(NOW + 133 * MINUTE).toISOString() },
    { kind: 'seven_day', percentUsed: 23, resetsAt: new Date(NOW + 90 * 60 * MINUTE).toISOString() },
  ],
}

const ACCOUNT = JSON.stringify({
  oauthAccount: { organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' },
})

type Surface = (typeof SURFACES)[number]

function hint(surface: Surface, columns: number, text = '? for shortcuts') {
  return {
    plugin: 'mk-usage',
    surface,
    component: 'PromptHint' as const,
    props: { isDraft: false, isWorking: false, hint: text },
    viewport: { columns, rows: 40 },
  }
}

function band(surface: Surface, columns: number, hasSurvey = false) {
  return {
    plugin: 'mk-usage',
    surface,
    component: 'AbovePrompt' as const,
    props: { hasSurvey, isWorking: false, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
    viewport: { columns: columns + 5, rows: 40 },
  }
}

function pane(surface: Surface) {
  return {
    plugin: 'mk-usage',
    surface,
    component: 'Pane' as const,
    requestId: 'mk-usage',
    props: { title: 'mk-usage', isFocused: true, bodyColumns: 100, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    viewport: { columns: 120, rows: 40 },
  }
}

/** The world beneath the mod: clock, store, env, the account file, and the engine's own drawings. */
async function start(
  $: Engine,
  on: On,
  entries: Record<string, unknown>,
  env: Record<string, string> = {},
  account: string = ACCOUNT,
) {
  mock.clock(on, { now: NOW })
  mock.store(on, entries)
  mock.env(on, { HOME: '/home/test', LANG: 'es_AR.UTF-8', ...env })
  on('fs.read', ($, e) => (e.path === '/home/test/.claude.json' ? { value: account } : { deny: `no file ${e.path}` }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '-0300\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  on('command.register', () => ({ value: { command: 'mk-usage' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The engine's hint line: its text, then the tail a plugin added.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint + (e.props.tail ?? '')}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function hintText($: Engine, surface: Surface, columns: number, text?: string) {
  const ui = await $.ui.mount(hint(surface, columns, text))
  const found = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return found
}

async function bandRow($: Engine, surface: Surface, columns: number, hasSurvey = false) {
  const ui = await $.ui.mount(band(surface, columns, hasSurvey))
  const row = await ui.find({ type: 'Text', text: /Sesión|Semana|Session|Week/ })
  const percents = await ui.findAll({ type: 'Text', text: /^\d+%$/ })
  await ui.unmount()
  return { text: row?.text, percents: percents.map(p => ({ text: p.text, color: p.props.color, bold: p.props.bold })) }
}

describe('under the prompt (default)', () => {
  test('named blocks after the engine\'s hint, with the estimate, no row of its own', { options: { renewal_date: '2026-11-02' } }, async ($, on) => {
    await start($, on, { reading: READING })
    for (const surface of SURFACES) {
      expect(await hintText($, surface, 140)).toBe(
        '? for shortcutsSesión 5h 52% · ~93% al reinicio │ Semana 23% · ~50% al reinicio │ Renueva en 21 d',
      )
      expect((await bandRow($, surface, 140)).text).toBeUndefined()
    }
  })

  test('narrower, the estimate shortens before it goes', { options: { renewal_date: '2026-11-02' } }, async ($, on) => {
    await start($, on, { reading: READING })
    expect(await hintText($, 'terminal', 112)).toBe('? for shortcutsSesión 5h 52% (~93%) │ Semana 23% (~50%) │ Renueva en 21 d')
    expect(await hintText($, 'terminal', 80)).toBe('? for shortcutsSesión 5h 52% │ Semana 23%')
  })

  test('the engine\'s own pills are counted even when the hint leaves them out', { options: { renewal_date: '2026-11-02' } }, async ($, on) => {
    await start($, on, { reading: READING })
    const withPill = await hintText($, 'terminal', 120, '(shift+tab to cycle) · ← for agents')
    const withoutPill = await hintText($, 'terminal', 120, '(shift+tab to cycle)')
    expect(withPill?.slice('(shift+tab to cycle) · ← for agents'.length)).toBe(
      'Sesión 5h 52% (~93%) │ Semana 23% (~50%) │ Renueva en 21 d',
    )
    expect(withoutPill?.slice('(shift+tab to cycle)'.length)).toBe(
      'Sesión 5h 52% (~93%) │ Semana 23% (~50%) │ Renueva en 21 d',
    )
  })

  test('nothing is added before any reading', async ($, on) => {
    await start($, on, {})
    expect(await hintText($, 'terminal', 140)).toBe('? for shortcuts')
  })

  test('a measurement updates the line', async ($, on) => {
    await start($, on, { reading: READING })
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 61, resetsAt: new Date(NOW + 2 * 60 * MINUTE).toISOString() }],
      changed: ['rateLimits'],
    })
    expect(await hintText($, 'terminal', 140)).toContain('Sesión 5h 61%')
  })
})

describe('preferences', () => {
  test('the configured default placement draws, and a command\'s choice holds over it', { options: { placement: 'band' } }, async ($, on) => {
    await start($, on, { reading: READING })
    expect((await bandRow($, 'terminal', 140)).text).toContain('Sesión 5h  52%')
    expect(await hintText($, 'terminal', 140)).toBe('? for shortcuts')
    await $.command.run({ command: 'mk-usage', args: 'footer', ...PROMPT })
    expect((await bandRow($, 'terminal', 140)).text).toBeUndefined()
    expect(await hintText($, 'terminal', 140)).toContain('Sesión 5h 52%')
  })

  test('English, from the system\'s locale, in the line and the command', async ($, on) => {
    await start($, on, { reading: READING }, { LANG: 'en_US.UTF-8' })
    const line = await hintText($, 'terminal', 140)
    expect(line).toContain('Session 5h 52% · ~93% at reset')
    expect(line).toContain('│ Week 23%')
    expect(line).not.toMatch(/Sesión|Semana|Renueva/)
    expect(await $.command.run({ command: 'mk-usage', args: 'band', ...PROMPT })).toEqual({})
    expect((await bandRow($, 'terminal', 140)).text).toContain('Session 5h  52%')
  })

  test('the figures are kept per account: another account starts empty', async ($, on) => {
    const other = JSON.stringify({ oauthAccount: { accountUuid: 'other', organizationType: 'claude_pro' } })
    await start($, on, { 'reading:someone': READING }, {}, other)
    expect(await hintText($, 'terminal', 140)).toBe('? for shortcuts')
  })

  test('figures stored before they were kept per account are taken once', async ($, on) => {
    const me = JSON.stringify({ oauthAccount: { accountUuid: 'me', organizationType: 'claude_max' } })
    await start($, on, { reading: READING }, {}, me)
    expect(await hintText($, 'terminal', 140)).toContain('Sesión 5h 52%')
  })
})

describe('command', () => {
  test('/mk-usage franja: a row of its own above the prompt, percents in the theme\'s colors', { options: { renewal_date: '2026-11-02' } }, async ($, on) => {
    await start($, on, { reading: READING })
    expect(await $.command.run({ command: 'mk-usage', args: 'franja', ...PROMPT })).toEqual({})
    for (const surface of SURFACES) {
      const { text, percents } = await bandRow($, surface, 140)
      expect(text).toBe(
        'Sesión 5h  52% · ~93% al reinicio (17:13)  │  Semana  23% · ~50% al reinicio (vie 16 09:00)  │  Renueva  en 21 d',
      )
      expect(percents).toEqual([
        { text: '52%', color: 'warning', bold: true },
        { text: '23%', color: 'success', bold: true },
      ])
      expect(await hintText($, surface, 140)).toBe('? for shortcuts')
    }
    expect((await bandRow($, 'terminal', 140, true)).text).toBeUndefined()
  })

  test('/mk-usage oculto shows nothing anywhere', async ($, on) => {
    await start($, on, { reading: READING })
    expect(await $.command.run({ command: 'mk-usage', args: 'oculto', ...PROMPT })).toEqual({})
    expect(await hintText($, 'terminal', 140)).toBe('? for shortcuts')
    expect((await bandRow($, 'terminal', 140)).text).toBeUndefined()
  })

  test('/mk-usage alone opens the detail, printing nothing', { options: { renewal_date: '2026-11-02' } }, async ($, on) => {
    await start($, on, { reading: READING })
    expect(await $.command.run({ command: 'mk-usage', args: '', ...PROMPT })).toEqual({})
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await ui.find({ type: 'Text', text: /Max 5x · renueva el 2 nov \(en 21 d\)/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Sesión 5h  52%  ~93% al reinicio/ })).toBeDefined()
      expect(await ui.find({ text: /[↻→█░]/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('an unknown word prints nothing either', async ($, on) => {
    await start($, on, { reading: READING })
    expect(await $.command.run({ command: 'mk-usage', args: 'enorme', ...PROMPT })).toEqual({})
  })
})
