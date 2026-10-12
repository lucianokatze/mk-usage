// mk-usage: the plan's limits (the 5-hour session and the week), where each
// ends at the reset at the current pace, and when the subscription renews.
//
// By default at the end of the hint line under the prompt, a row that is there
// anyway: named blocks, `Sesión 5h │ Semana │ Renueva`, in Claude's gray (the
// engine paints that line itself), the words saying when a window runs out.
// `/mk-usage band` (`franja`) moves it to a row of its own above the prompt,
// in the theme's colors; the detail shows on `/mk-usage`, in a pane Esc
// closes. Every word, threshold and default is the person's (the manifest's
// `userConfig`). It reads what the engine already has: no model call, and the
// commands print nothing.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionRateLimit } from 'claude-code'

import type { Placement, PlacementChoice, Reading } from '../types'
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

const reading = atom({ plugin: 'mk-usage', key: 'reading' } as const, null)
const history = atom({ plugin: 'mk-usage', key: 'history' } as const, {})
const profile = atom({ plugin: 'mk-usage', key: 'profile' } as const, null)
const placement = atom({ plugin: 'mk-usage', key: 'placement' } as const, 'footer')

const PANE = 'mk-usage'
const TICK_MS = 30_000
/** Ticks between two readings of the profile: an hour, for a clock change or a /login. */
const PROFILE_EVERY = 120

// Theme keys, so the colors follow the person's theme (daltonized ones
// included); `inactive` is the gray of Claude's own footer.
const COLORS: Record<Tone, string | undefined> = {
  text: undefined,
  muted: 'inactive',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
}

function styleOf(segment: Segment): { color?: string; bold?: boolean } {
  const color = COLORS[segment.tone]
  return { ...(color === undefined ? {} : { color }), ...(segment.isBold === true ? { bold: true } : {}) }
}

/** Copies what the store keeps for this account (every session shares it) into this session's state. */
async function loadSaved($: EngineInterface, configDefault: Placement): Promise<void> {
  const who = await read($, profile)
  // Figures stored before they were kept per account sit under the bare key:
  // taken once, until this account stores its own.
  const savedReading = (await $.store.get(keyFor('reading', who))) ?? (await $.store.get('reading'))
  const savedHistory = (await $.store.get(keyFor('history', who))) ?? (await $.store.get('history'))
  const savedPlacement = await $.store.get('placement')
  await update($, reading, () => (isReading(savedReading) ? savedReading : null))
  await update($, history, () => (isHistory(savedHistory) ? savedHistory : {}))
  await update($, placement, () => placementFrom(savedPlacement, configDefault))
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

/** What every drawing reads; reading it while drawing subscribes the drawing. */
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

let ticks = 0

/**
 * Every 30 seconds: a newer reading another session stored, the countdowns
 * redrawn; every hour, the profile again (a clock change, a /login to another
 * account, whose own figures are then loaded).
 */
async function tick($: EngineInterface, configDefault: Placement): Promise<void> {
  ticks += 1
  try {
    if (ticks % PROFILE_EVERY === 0) {
      const before = (await read($, profile))?.account
      await loadProfile($)
      if ((await read($, profile))?.account !== before) await loadSaved($, configDefault)
    }
    await takeNewer($)
  } catch {
    // The line keeps what it has.
  }
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  const configDefault = placementOf(options.placement) ?? 'footer'

  on('session.start', async ($, e, next) => {
    // The profile first: it names the account the stored figures belong to.
    try {
      await loadProfile($)
    } catch {
      // The figures are kept unkeyed and the detail goes without the plan.
    }
    try {
      await loadSaved($, configDefault)
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
      void tick($, configDefault)
    })
    try {
      const { words } = prefsFrom(options, (await read($, profile))?.locale)
      const names = words.placementNames
      await $.command.register({
        name: 'mk-usage',
        description: words.commandDescription,
        argumentHint: `[${names.footer}|${names.band}|${names.hidden}]`,
        immediate: true,
      })
    } catch {
      // The line works without the command.
    }
    // A site may have been drawn before the state above was loaded.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // /clear, /resume and /branch reset $.state and do not raise session.start again.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      try {
        await loadProfile($)
        await loadSaved($, configDefault)
      } catch {
        // The next tick or measurement fills it in.
      }
    }
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

  // Default: the blocks after the engine's own hint, on a row that is there
  // anyway. The engine draws that line in its own gray: plain text.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if ((await read($, placement)) !== 'footer') return next(e)
    const view = await viewOf($, options)
    if (view === null) return next(e)
    // `hint` is only part of the line: the engine also draws its indent, the
    // mode pill and the separator before the tail (`  ⏵⏵ auto mode on ` … ` · `,
    // 21 columns), and the `· ← for agents` pill (15 more) whether or not `hint`
    // carries it. Measured on 2.1.296; 3 columns of margin.
    const engineDraws = e.props.hint.includes('←') ? 21 : 36
    const room = (e.viewport?.columns ?? 80) - e.props.hint.length - engineDraws - 3
    const summary = textOf(fitLine(view, room, 'footer'))
    if (summary === '') return next(e)
    return next({ ...e, props: { ...e.props, tail: summary } })
  })

  // `/mk-usage band`: one row of its own above the prompt, in the theme's colors.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, placement)) !== 'band') return next(e)
    const view = await viewOf($, options)
    if (view === null) return next(e)
    const row = fitLine(view, e.props.bodyColumns)
    if (row.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {row.map(segment => (
            <Text {...styleOf(segment)}>{segment.text}</Text>
          ))}
        </Text>
        {theirs}
      </Box>
    )
  })

  // The detail, only while the person keeps the pane `/mk-usage` opened.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = await viewOf($, options)
    const { words } = prefsFrom(options, (await read($, profile))?.locale)
    const rows: Row[] = view === null ? [[{ text: words.noData, tone: 'muted' }]] : detailRows(view)

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text wrap="truncate-end">
            {row.map(segment => (
              <Text {...styleOf(segment)}>{segment.text}</Text>
            ))}
          </Text>
        ))}
        <Text color="inactive">{words.escCloses}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'mk-usage' }, async ($, e) => {
    const { words } = prefsFrom(options, (await read($, profile))?.locale)
    const asked = e.args.trim()
    if (asked === '' || /^(detalle|detail)$/i.test(asked)) {
      await $.ui.open({ id: PANE, title: 'mk-usage', focus: true, closeOnEscape: true })
      return {}
    }
    const chosen = placementOf(asked)
    if (chosen === undefined) {
      $.ui.toast(words.usage(PLACEMENTS.map(p => words.placementNames[p]).join('|')))
      return {}
    }
    await update($, placement, () => chosen)
    const choice: PlacementChoice = { value: chosen, configDefault }
    await $.store.set('placement', choice)
    $.ui.toast(words.movedTo[chosen])
    return {}
  })
}
