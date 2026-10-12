import { describe, expect, test } from 'claude-code/testing'

import type { Limit, Sample } from '../types'
import {
  DEFAULT_PREFS,
  DAY,
  HOUR,
  MINUTE,
  addSamples,
  dateOf,
  detailRows,
  duration,
  fitLine,
  nextRenewal,
  clockOf,
  keyFor,
  parseOffset,
  placementFrom,
  placementOf,
  planLabel,
  prefsFrom,
  roughly,
  statusOf,
  profileFrom,
  project,
  whenOf,
} from '../hooks/usage'
import type { Row, View } from '../hooks/usage'
import { WORDS, languageOf } from '../hooks/words'
import { textOf as lineOf } from '../hooks/usage'

const TZ = -180
// Monday 12 Oct 2026, 15:00 at UTC-3.
const NOW = Date.UTC(2026, 9, 12, 18, 0)

const iso = (ms: number) => new Date(ms).toISOString()
const fiveHour = (p: number, resetsIn: number): Limit => ({ kind: 'five_hour', percentUsed: p, resetsAt: iso(NOW + resetsIn) })
const sevenDay = (p: number, resetsIn: number): Limit => ({ kind: 'seven_day', percentUsed: p, resetsAt: iso(NOW + resetsIn) })
const textOf = (rows: Row[]) => rows.map(row => row.map(s => s.text).join('')).join('\n')

describe('renewal', () => {
  test('the configured day counts down to 2 nov', () => {
    const renewal = nextRenewal('2026-11-02', undefined, NOW, TZ)
    expect(renewal?.days).toBe(21)
    expect(renewal?.isEstimate).toBe(false)
    expect(dateOf(renewal?.at ?? 0, TZ)).toBe('2 nov')
  })

  test('DD/MM/AAAA reads the same day', () => {
    expect(nextRenewal('02/11/2026', undefined, NOW, TZ)?.days).toBe(21)
  })

  test('the day after a renewal moves on a month', () => {
    const renewal = nextRenewal('2026-11-02', undefined, Date.UTC(2026, 10, 3, 15), TZ)
    expect(dateOf(renewal?.at ?? 0, TZ)).toBe('2 dic')
    expect(renewal?.days).toBe(29)
  })

  test('the renewal day itself reads today', () => {
    expect(nextRenewal('2026-11-02', undefined, Date.UTC(2026, 10, 2, 13), TZ)?.days).toBe(0)
  })

  test('day 31 stops at the end of a shorter month', () => {
    const renewal = nextRenewal('2026-01-31', undefined, Date.UTC(2026, 1, 10, 15), TZ)
    expect(dateOf(renewal?.at ?? 0, TZ)).toBe('28 feb')
  })

  test('without a configured day it estimates from the subscription', () => {
    const renewal = nextRenewal(undefined, '2026-03-18T01:43:44.259354Z', NOW, TZ)
    expect(renewal?.isEstimate).toBe(true)
    expect(dateOf(renewal?.at ?? 0, TZ)).toBe('18 oct')
    expect(renewal?.days).toBe(6)
  })

  test('nothing to go on gives no renewal', () => {
    expect(nextRenewal('pronto', undefined, NOW, TZ)).toBeUndefined()
  })
})

describe('projection', () => {
  test('one reading uses the average since the window opened', () => {
    // 52% in the 2h47m since the window opened: ~18.7%/h, ~93% at the reset.
    const result = project(fiveHour(52, 133 * MINUTE), [], NOW)
    expect(result).toMatchObject({ kind: 'atReset', percent: 93 })
  })

  test('a recent climb projects running out before the reset', () => {
    const samples: Sample[] = [
      { t: NOW - 30 * MINUTE, p: 40 },
      { t: NOW - 20 * MINUTE, p: 44 },
      { t: NOW - 10 * MINUTE, p: 48 },
    ]
    const result = project(fiveHour(52, 133 * MINUTE), samples, NOW)
    expect(result.kind).toBe('exhausts')
    if (result.kind !== 'exhausts') return
    expect(Math.round(result.ratePerHour)).toBe(24)
    expect(Math.round(result.inMs / MINUTE)).toBe(120)
    expect(result.isUrgent).toBe(false)
  })

  test('a flat last half hour is no recent use', () => {
    const samples: Sample[] = [
      { t: NOW - 30 * MINUTE, p: 52 },
      { t: NOW - 15 * MINUTE, p: 52 },
    ]
    expect(project(fiveHour(52, 133 * MINUTE), samples, NOW).kind).toBe('idle')
  })

  test('the weekly window projects over its whole week', () => {
    // 23% in the 78h since it opened, 90h still to go: ~50% at the reset.
    const result = project(sevenDay(23, 90 * HOUR), [], NOW)
    expect(result).toMatchObject({ kind: 'atReset', percent: 50 })
  })

  test('a full window is exhausted', () => {
    expect(project(fiveHour(100, HOUR), [], NOW).kind).toBe('exhausted')
  })

  test('a window with no length and no samples is unknown', () => {
    expect(project({ kind: 'spend_limit', percentUsed: 30 }, [], NOW).kind).toBe('unknown')
  })
})

describe('history', () => {
  test('a new cycle starts the samples over, a jitter does not', () => {
    const first = addSamples({}, [fiveHour(10, 4 * HOUR)], NOW)
    const jitter = addSamples(first, [{ ...fiveHour(12, 4 * HOUR + 2 * MINUTE) }], NOW + MINUTE)
    expect(jitter.five_hour?.samples).toHaveLength(2)
    const fresh = addSamples(jitter, [fiveHour(1, 9 * HOUR)], NOW + 2 * MINUTE)
    expect(fresh.five_hour?.samples).toHaveLength(1)
  })

  test('the weekly window keeps about one sample per ten minutes', () => {
    let history = addSamples({}, [sevenDay(20, 3 * DAY)], NOW)
    for (const minutes of [3, 6, 12]) {
      history = addSamples(history, [sevenDay(20 + minutes / 10, 3 * DAY)], NOW + minutes * MINUTE)
    }
    expect(history.seven_day?.samples.map(s => (s.t - NOW) / MINUTE)).toEqual([0, 6, 12])
  })

  test('an older reading from another session is not added', () => {
    const history = addSamples({}, [fiveHour(10, 4 * HOUR)], NOW)
    expect(addSamples(history, [fiveHour(9, 4 * HOUR)], NOW - MINUTE).five_hour?.samples).toHaveLength(1)
  })
})

describe('words', () => {
  test('durations', () => {
    expect(duration(30_000)).toBe('<1m')
    expect(duration(45 * MINUTE)).toBe('45m')
    expect(duration(133 * MINUTE)).toBe('2h13m')
    expect(duration(125 * MINUTE)).toBe('2h05m')
    expect(duration(2 * HOUR)).toBe('2h')
    expect(duration(90 * HOUR)).toBe('3d18h')
  })

  test('when, by distance from today', () => {
    expect(whenOf(NOW + 40 * MINUTE, NOW, TZ)).toBe('15:40')
    expect(whenOf(NOW + 19 * HOUR, NOW, TZ)).toBe('mañana 10:00')
    expect(whenOf(NOW + 4 * DAY - 5 * HOUR, NOW, TZ)).toBe('vie 16 10:00')
    expect(whenOf(NOW + 21 * DAY, NOW, TZ)).toBe('2 nov 15:00')
  })

  test('plan and offset', () => {
    expect(planLabel('claude_max', 'default_claude_max_5x')).toBe('Max 5x')
    expect(planLabel('claude_pro', undefined)).toBe('Pro')
    expect(planLabel(undefined, undefined)).toBeUndefined()
    expect(parseOffset('-0300\n')).toBe(-180)
    expect(parseOffset('+05:30')).toBe(330)
    expect(parseOffset('UTC')).toBeUndefined()
  })

  test('the profile takes the plan and nothing else', () => {
    const text = JSON.stringify({
      oauthAccount: {
        organizationType: 'claude_max',
        organizationRateLimitTier: 'default_claude_max_5x',
        subscriptionCreatedAt: '2026-03-18T01:43:44Z',
        emailAddress: 'someone@example.com',
      },
    })
    expect(profileFrom(text, TZ)).toEqual({ tzOffsetMin: TZ, plan: 'Max 5x', createdAt: '2026-03-18T01:43:44Z' })
    expect(profileFrom('not json', TZ)).toEqual({ tzOffsetMin: TZ })
  })
})

describe('rounding and state', () => {
  test('rough durations change seldom', () => {
    expect(roughly(2 * MINUTE)).toBe('~5m')
    expect(roughly(37 * MINUTE)).toBe('~35m')
    expect(roughly(116 * MINUTE)).toBe('~2h')
    expect(roughly(100 * MINUTE)).toBe('~1h30m')
    expect(roughly(14.4 * HOUR)).toBe('~14h')
    expect(roughly(58 * HOUR)).toBe('~2d 10h')
    expect(roughly(72 * HOUR)).toBe('~3d')
  })

  test('the state: fine, tight, runs out first', () => {
    expect(statusOf(40, { kind: 'atReset', percent: 70, ratePerHour: 5 })).toBe('ok')
    expect(statusOf(40, { kind: 'atReset', percent: 88, ratePerHour: 5 })).toBe('warn')
    expect(statusOf(78, { kind: 'idle' })).toBe('ok')
    expect(statusOf(86, { kind: 'idle' })).toBe('warn')
    expect(statusOf(60, { kind: 'atReset', percent: 72, ratePerHour: 5 }, { warnPercent: 70, criticalPercent: 90 })).toBe('warn')
    expect(statusOf(91, { kind: 'idle' }, { warnPercent: 70, criticalPercent: 90 })).toBe('bad')
    expect(statusOf(40, { kind: 'exhausts', at: NOW, inMs: HOUR, ratePerHour: 30, isUrgent: false })).toBe('bad')
    expect(statusOf(96, { kind: 'idle' })).toBe('bad')
  })
})

describe('preferences', () => {
  test('the language follows the system unless one is set', () => {
    expect(prefsFrom({}, 'es_AR.UTF-8').words).toBe(WORDS.es)
    expect(prefsFrom({}, 'en_US.UTF-8').words).toBe(WORDS.en)
    expect(prefsFrom({}, undefined).words).toBe(WORDS.en)
    expect(prefsFrom({ language: 'es' }, 'en_US.UTF-8').words).toBe(WORDS.es)
    expect(prefsFrom({ language: 'en' }, 'es_ES.UTF-8').words).toBe(WORDS.en)
    expect(languageOf('es')).toBe('es')
    expect(languageOf('estonian')).toBe('en')
  })

  test('defaults, and values out of range fall back to them', () => {
    const prefs = prefsFrom({}, 'es_ES.UTF-8')
    expect({ ...prefs, words: undefined }).toEqual({ ...DEFAULT_PREFS, words: undefined })
    expect(prefsFrom({ warn_percent: 0, critical_percent: 400 }, 'es').warnPercent).toBe(85)
    expect(prefsFrom({ warn_percent: 0, critical_percent: 400 }, 'es').criticalPercent).toBe(95)
    expect(prefsFrom({ warn_percent: 90, critical_percent: 50 }, 'es').criticalPercent).toBe(90)
    expect(prefsFrom({ renewal_date: '   ' }, 'es').renewalDate).toBeUndefined()
    expect(prefsFrom({ show_renewal: false, billing_period: 'yearly', time_format: '12h' }, 'es')).toMatchObject({
      showRenewal: false,
      billing: 'yearly',
      timeFormat: '12h',
    })
  })

  test('placements by their word in either language', () => {
    expect(placementOf('pie')).toBe('footer')
    expect(placementOf(' FRANJA ')).toBe('band')
    expect(placementOf('off')).toBe('hidden')
    expect(placementOf('hidden')).toBe('hidden')
    expect(placementOf('arriba')).toBeUndefined()
  })

  test('a command\'s placement holds until the configured default changes', () => {
    const chosen = { value: 'band', configDefault: 'footer' }
    expect(placementFrom(chosen, 'footer')).toBe('band')
    expect(placementFrom(chosen, 'hidden')).toBe('hidden')
    expect(placementFrom('franja', 'footer')).toBe('footer')
    expect(placementFrom(undefined, 'band')).toBe('band')
  })

  test('a yearly plan renews a year at a time', () => {
    const renewal = nextRenewal('2025-11-02', undefined, NOW, TZ, 'yearly')
    expect(dateOf(renewal?.at ?? 0, TZ)).toBe('2 nov')
    expect(renewal?.days).toBe(21)
    const later = nextRenewal('2026-01-15', undefined, NOW, TZ, 'yearly')
    expect(new Date(later?.at ?? 0).getUTCFullYear()).toBe(2027)
  })

  test('each account keeps its own figures; an organization pays its own renewal', () => {
    const personal = profileFrom(JSON.stringify({ oauthAccount: { accountUuid: 'a-1', organizationType: 'claude_max' } }), TZ)
    const team = profileFrom(
      JSON.stringify({ oauthAccount: { accountUuid: 'a-1', organizationUuid: 'o-9', organizationType: 'claude_team' } }),
      TZ,
    )
    expect(keyFor('reading', personal)).toBe('reading:a-1')
    expect(keyFor('reading', team)).toBe('reading:o-9')
    expect(keyFor('reading', null)).toBe('reading')
    expect(personal.isOrganizationBilled).toBeUndefined()
    expect(team.isOrganizationBilled).toBe(true)
  })

  test('12-hour clock', () => {
    expect(clockOf(NOW + 133 * MINUTE, TZ, '12h')).toBe('5:13pm')
    expect(clockOf(Date.UTC(2026, 9, 12, 3, 5), TZ, '12h')).toBe('12:05am')
    expect(clockOf(NOW + 133 * MINUTE, TZ)).toBe('17:13')
  })
})

describe('layouts', () => {
  const view = (changes: Partial<View> = {}): View => ({
    reading: { at: NOW - MINUTE, limits: [sevenDay(23, 90 * HOUR), fiveHour(52, 133 * MINUTE)] },
    history: {},
    profile: { plan: 'Max 5x', tzOffsetMin: TZ },
    prefs: { ...DEFAULT_PREFS, renewalDate: '2026-11-02' },
    now: NOW,
    ...changes,
  })
  const FULL =
    'Sesión 5h  52% · ~93% al reinicio (17:13)  │  Semana  23% · ~50% al reinicio (vie 16 09:00)  │  Renueva  en 21 d'

  test('wide: named blocks with the estimate and the reset, session first, divided by │', () => {
    expect(lineOf(fitLine(view(), 200))).toBe(FULL)
  })

  test('narrower, the reset times go first, then the renewal, keeping the estimate', () => {
    expect(lineOf(fitLine(view(), 100))).toBe(
      'Sesión 5h  52% · ~93% al reinicio  │  Semana  23% · ~50% al reinicio  │  Renueva  en 21 d',
    )
    expect(lineOf(fitLine(view(), 70))).toBe('Sesión 5h  52% · ~93% al reinicio  │  Semana  23% · ~50% al reinicio')
  })

  test('narrower still: short estimates without the renewal, the named percentages, the first window, nothing', () => {
    expect(lineOf(fitLine(view(), 50))).toBe('Sesión 5h  52% (~93%)  │  Semana  23% (~50%)')
    expect(lineOf(fitLine(view(), 38))).toBe('Sesión 5h  52% (~93%)  │  Semana  23%')
    expect(lineOf(fitLine(view(), 30))).toBe('Sesión 5h  52%  │  Semana  23%')
    // Never a row wider than its room, which the engine would cut with `…`.
    expect(lineOf(fitLine(view(), 20))).toBe('Sesión 5h  52%')
    expect(lineOf(fitLine(view(), 5))).toBe('')
  })

  test('a window running out keeps its warning after the renewal and the fine estimates are gone', () => {
    const steep: Sample[] = [
      { t: NOW - 20 * HOUR, p: 11 },
      { t: NOW - 10 * HOUR, p: 31 },
      { t: NOW - 3 * HOUR, p: 45 },
    ]
    const tight = view({
      reading: { at: NOW - MINUTE, limits: [sevenDay(51, 54 * HOUR), fiveHour(49, 146 * MINUTE)] },
      history: { seven_day: { resetsAt: null, samples: steep } },
    })
    const footer = lineOf(fitLine(tight, 61, 'footer'))
    expect(footer).toMatch(/^Sesión 5h 49%( \(~\d+%\))? │ Semana 51% \(se agota ~\d+h\)$/)
    expect(lineOf(fitLine(tight, 41, 'footer'))).toMatch(/^Sesión 5h 49% │ Semana 51% \(agota ~\d+h\)$/)
  })

  test('every variant is one row with no glyph that draws over its neighbor', () => {
    for (const width of [5, 50, 70, 100, 200]) {
      expect(lineOf(fitLine(view(), width))).not.toMatch(/[\n↻→█░]/)
    }
  })

  test('running out before the reset says when, in the error tone', () => {
    const climbing: Sample[] = [
      { t: NOW - 30 * MINUTE, p: 40 },
      { t: NOW - 20 * MINUTE, p: 44 },
      { t: NOW - 10 * MINUTE, p: 48 },
    ]
    const row = fitLine(view({ history: { five_hour: { resetsAt: null, samples: climbing } } }), 200)
    expect(lineOf(row)).toContain('Sesión 5h  52% · se agota en ~2h (reinicia 17:13)')
    expect(row.find(s => s.text === '52%')?.tone).toBe('bad')
    expect(row.find(s => s.text.startsWith('se agota'))?.tone).toBe('bad')
  })

  test('the percent takes the state: fine, tight, nearly full', () => {
    const row = fitLine(view(), 200)
    expect(row.find(s => s.text === '23%')?.tone).toBe('ok')
    expect(row.find(s => s.text === '52%')?.tone).toBe('warn')
    expect(row.find(s => s.text === '52%')?.isBold).toBe(true)
    const full = fitLine(view({ reading: { at: NOW, limits: [fiveHour(96, HOUR)] } }), 200)
    expect(full.find(s => s.text === '96%')?.tone).toBe('bad')
  })

  test('under the prompt: tight spacing, and a short estimate before none', () => {
    expect(lineOf(fitLine(view(), 90, 'footer'))).toBe(
      'Sesión 5h 52% · ~93% al reinicio │ Semana 23% · ~50% al reinicio │ Renueva en 21 d',
    )
    expect(lineOf(fitLine(view(), 60, 'footer'))).toBe('Sesión 5h 52% (~93%) │ Semana 23% (~50%) │ Renueva en 21 d')
    expect(lineOf(fitLine(view(), 30, 'footer'))).toBe('Sesión 5h 52% │ Semana 23%')
  })

  test('a window past its reset shows no stale percent; an old reading says how old', () => {
    const old = view({ reading: { at: NOW - 25 * MINUTE, limits: [fiveHour(52, -MINUTE)] } })
    expect(lineOf(fitLine(old, 200))).toBe('Sesión 5h  reiniciada  │  Renueva  en 21 d  │  dato de hace 25m')
  })

  test('the detail: plan and renewal, then two rows per window', () => {
    const text = textOf(detailRows(view()))
    expect(text).toBe(
      [
        'Max 5x · renueva el 2 nov (en 21 d)',
        'Sesión 5h  52%  ~93% al reinicio',
        '  reinicia 17:13 (en 2h13m) · ritmo 19%/h',
        'Semana     23%  ~50% al reinicio',
        '  reinicia vie 16 09:00 (en 3d18h) · ritmo 7.1%/día',
      ].join('\n'),
    )
    expect(text).not.toMatch(/[↻→█░]/)
  })

  test('in English, with a 12-hour clock', () => {
    const en = view({ prefs: { ...DEFAULT_PREFS, words: WORDS.en, timeFormat: '12h', renewalDate: '2026-11-02' } })
    expect(lineOf(fitLine(en, 200))).toBe(
      'Session 5h  52% · ~93% at reset (5:13pm)  │  Week  23% · ~50% at reset (Fri 16 9:00am)  │  Renews  in 21 d',
    )
    expect(textOf(detailRows(en))).toContain('Max 5x · renews Nov 2 (in 21 d)')
  })

  test('the renewal hides when asked, and is never estimated for an organization', () => {
    const hidden = view({ prefs: { ...DEFAULT_PREFS, renewalDate: '2026-11-02', showRenewal: false } })
    expect(lineOf(fitLine(hidden, 200))).not.toContain('Renueva')
    const team = view({
      profile: { plan: 'Team', tzOffsetMin: TZ, createdAt: '2026-03-18T01:43:44Z', isOrganizationBilled: true },
      prefs: DEFAULT_PREFS,
    })
    expect(lineOf(fitLine(team, 200))).not.toContain('Renueva')
    const teamWithDate = view({ ...team, prefs: { ...DEFAULT_PREFS, renewalDate: '2026-11-02' } })
    expect(lineOf(fitLine(teamWithDate, 200))).toContain('Renueva  en 21 d')
  })

  test('an estimated renewal says so in the detail', () => {
    const estimated = view({ profile: { plan: 'Max 5x', tzOffsetMin: TZ, createdAt: '2026-03-18T01:43:44Z' }, prefs: DEFAULT_PREFS })
    const text = textOf(detailRows(estimated))
    expect(text).toContain('renueva el ≈18 oct (en 6 d)')
    expect(text).toContain('≈ estimada')
  })
})
