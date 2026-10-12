// Pure logic of mk-usage: no `$` here, so tests reach every function directly.
// Times are epoch milliseconds; local dates go through `tzOffsetMin` (minutes
// east of UTC) and the getUTC* methods, so nothing depends on the runtime's zone.
// Every word comes from `Prefs.words` and every threshold from `Prefs`.

import type { History, Limit, Placement, Profile, Reading, Sample, Track } from '../types'
import { WORDS, languageOf } from './words'
import type { Words } from './words'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const PLACEMENTS: readonly Placement[] = ['footer', 'band', 'hidden']

// Tuning of the estimate, not a preference: how old a reading may get before
// the line says so, how far apart two readings of one cycle may report its
// reset, how often a weekly window keeps a sample, how many it keeps, and the
// pace under which a window counts as unused.
const STALE_AFTER = 15 * MINUTE
const SAME_CYCLE = 5 * MINUTE
const LONG_STEP = 10 * MINUTE
const MAX_SAMPLES = 600
const MIN_RATE_PER_HOUR = 0.05

const PLAN_NAMES: Record<string, string> = {
  claude_free: 'Free',
  claude_pro: 'Pro',
  claude_max: 'Max',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
}
const ORGANIZATION_PLANS = new Set(['claude_team', 'claude_enterprise'])

// ---------------------------------------------------------------- preferences

export type TimeFormat = '24h' | '12h'
export type Billing = 'monthly' | 'yearly'

/** What each person may set (the manifest's `userConfig`), read into one value. */
export type Prefs = {
  words: Words
  timeFormat: TimeFormat
  /** A window that reaches this percent, or is set to by its reset, is tight. */
  warnPercent: number
  /** A window past this percent is critical, as is one that runs out first. */
  criticalPercent: number
  showRenewal: boolean
  billing: Billing
  renewalDate: string | undefined
}

export const DEFAULT_PREFS: Prefs = {
  words: WORDS.es,
  timeFormat: '24h',
  warnPercent: 85,
  criticalPercent: 95,
  showRenewal: true,
  billing: 'monthly',
  renewalDate: undefined,
}

function percentOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100 ? value : fallback
}

/**
 * The person's options as the mod uses them, each checked and defaulted:
 * `language` `auto` follows the system's locale.
 */
export function prefsFrom(options: Readonly<Record<string, unknown>>, locale: string | undefined): Prefs {
  const language = options.language === 'es' || options.language === 'en' ? options.language : languageOf(locale)
  const warnPercent = percentOption(options.warn_percent, DEFAULT_PREFS.warnPercent)
  const renewalDate = typeof options.renewal_date === 'string' && options.renewal_date.trim() !== '' ? options.renewal_date : undefined
  return {
    words: WORDS[language],
    timeFormat: options.time_format === '12h' ? '12h' : '24h',
    warnPercent,
    criticalPercent: Math.max(warnPercent, percentOption(options.critical_percent, DEFAULT_PREFS.criticalPercent)),
    showRenewal: options.show_renewal !== false,
    billing: options.billing_period === 'yearly' ? 'yearly' : 'monthly',
    renewalDate,
  }
}

/** A placement by its word in either language: `pie`/`footer`, `franja`/`band`, `oculto`/`hidden`/`off`. */
export function placementOf(word: unknown): Placement | undefined {
  if (typeof word !== 'string') return undefined
  const w = word.trim().toLowerCase()
  if (w === 'footer' || w === 'pie') return 'footer'
  if (w === 'band' || w === 'franja') return 'band'
  if (w === 'hidden' || w === 'oculto' || w === 'off') return 'hidden'
  return undefined
}

// ---------------------------------------------------------------- windows

export function windowMs(kind: string): number | undefined {
  if (kind === 'five_hour') return 5 * HOUR
  if (kind.startsWith('seven_day')) return 7 * DAY
  return undefined
}

function isShort(kind: string): boolean {
  return kind === 'five_hour'
}

/**
 * The block's name: the plan's limits are a session that resets every five
 * hours and a week across all models (Max adds a week of its own for some
 * models); a gateway may set a spend limit. There is no monthly quota: the
 * month is the billing. A window the mod does not know shows its own name.
 */
export function labelOf(kind: string, words: Words = DEFAULT_PREFS.words): string {
  if (kind === 'five_hour') return words.session
  if (kind === 'seven_day') return words.week
  if (kind.startsWith('seven_day_')) {
    const model = kind.slice('seven_day_'.length)
    return words.weekOf(`${model.charAt(0).toUpperCase()}${model.slice(1)}`)
  }
  if (kind === 'spend_limit') return words.spend
  return kind
}

function rankOf(kind: string): number {
  if (kind === 'five_hour') return 0
  if (kind === 'seven_day') return 1
  if (kind.startsWith('seven_day')) return 2
  return 3
}

export function sortLimits(limits: readonly Limit[]): Limit[] {
  return [...limits].sort((a, b) => rankOf(a.kind) - rankOf(b.kind))
}

export function resetsAtMs(limit: Limit): number | undefined {
  if (limit.resetsAt === undefined) return undefined
  const ms = Date.parse(limit.resetsAt)
  return Number.isFinite(ms) ? ms : undefined
}

// ---------------------------------------------------------------- history

/** Adds one sample per window to its track, starting a new track on a new cycle. */
export function addSamples(history: History, limits: readonly Limit[], at: number): History {
  const next: History = { ...history }
  for (const limit of limits) {
    const resetsAt = resetsAtMs(limit) ?? null
    const held = next[limit.kind]
    const isSameCycle =
      held !== undefined &&
      (held.resetsAt === null || resetsAt === null
        ? held.resetsAt === resetsAt
        : Math.abs(held.resetsAt - resetsAt) <= SAME_CYCLE)
    const samples = isSameCycle ? [...held.samples] : []
    const last = samples[samples.length - 1]
    if (last !== undefined && at <= last.t) continue
    const point: Sample = { t: at, p: limit.percentUsed }
    // A long window keeps about one sample per LONG_STEP: the newest one moves
    // forward until it stands LONG_STEP past the one before it.
    const beforeLast = samples[samples.length - 2]
    if (beforeLast !== undefined && !isShort(limit.kind) && at - beforeLast.t < LONG_STEP) {
      samples[samples.length - 1] = point
    } else {
      samples.push(point)
    }
    const keep = windowMs(limit.kind) ?? DAY
    const kept = samples.filter(s => s.t >= at - keep).slice(-MAX_SAMPLES)
    const track: Track = { resetsAt, samples: kept }
    next[limit.kind] = track
  }
  for (const kind of Object.keys(next)) {
    const samples = next[kind]?.samples ?? []
    const newest = samples[samples.length - 1]
    if (newest === undefined || at - newest.t > 8 * DAY) delete next[kind]
  }
  return next
}

// ---------------------------------------------------------------- projection

export type Rate = { perMs: number; source: 'recent' | 'average' }

export type Projection =
  | { kind: 'exhausted' }
  | { kind: 'idle' }
  | { kind: 'unknown' }
  | { kind: 'exhausts'; at: number; inMs: number; ratePerHour: number; isUrgent: boolean }
  | { kind: 'atReset'; percent: number; ratePerHour: number }

function slopeOf(points: readonly Sample[]): number {
  const n = points.length
  const meanT = points.reduce((sum, s) => sum + s.t, 0) / n
  const meanP = points.reduce((sum, s) => sum + s.p, 0) / n
  let num = 0
  let den = 0
  for (const s of points) {
    num += (s.t - meanT) * (s.p - meanP)
    den += (s.t - meanT) ** 2
  }
  return den === 0 ? 0 : num / den
}

/**
 * Percent per millisecond. Recent: least-squares slope over the last hour (5h
 * window) or day (7d), the present point included so a pause lowers it.
 * Average: the fill over the time since the window opened.
 */
export function rateOf(limit: Limit, samples: readonly Sample[], now: number): Rate | undefined {
  const short = isShort(limit.kind)
  const lookback = short ? HOUR : DAY
  const minSpan = short ? 10 * MINUTE : 2 * HOUR
  const points = samples.filter(s => s.t >= now - lookback && s.t < now)
  points.push({ t: now, p: limit.percentUsed })
  const first = points[0]
  if (points.length >= 3 && first !== undefined && now - first.t >= minSpan) {
    return { perMs: Math.max(0, slopeOf(points)), source: 'recent' }
  }
  const length = windowMs(limit.kind)
  const resetsAt = resetsAtMs(limit)
  if (length === undefined || resetsAt === undefined) return undefined
  const elapsed = Math.max(now - (resetsAt - length), 10 * MINUTE)
  return { perMs: limit.percentUsed / elapsed, source: 'average' }
}

/** When the window would run out at the current rate, or where it ends up. */
export function project(limit: Limit, samples: readonly Sample[], now: number): Projection {
  const p = limit.percentUsed
  if (p >= 100) return { kind: 'exhausted' }
  const rate = rateOf(limit, samples, now)
  if (rate === undefined) return { kind: 'unknown' }
  const ratePerHour = rate.perMs * HOUR
  if (ratePerHour < MIN_RATE_PER_HOUR) return { kind: 'idle' }
  const inMs = (100 - p) / rate.perMs
  const resetsAt = resetsAtMs(limit)
  if (resetsAt !== undefined && now + inMs >= resetsAt) {
    const percent = Math.min(100, Math.round(p + rate.perMs * (resetsAt - now)))
    return { kind: 'atReset', percent, ratePerHour }
  }
  const isUrgent = inMs < (isShort(limit.kind) ? HOUR : DAY)
  return { kind: 'exhausts', at: now + inMs, inMs, ratePerHour, isUrgent }
}

// ---------------------------------------------------------------- renewal

type LocalDay = { y: number; m: number; d: number }

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

function localDayOf(ms: number, tzOffsetMin: number): LocalDay {
  const t = new Date(ms + tzOffsetMin * MINUTE)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }
}

/** `2026-11-02`, `02/11/2026` or `2-11-2026`, read as a calendar day. */
export function parseDay(text: string | undefined): LocalDay | undefined {
  if (text === undefined) return undefined
  const s = text.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  const [y, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : [NaN, NaN, NaN]
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000)) return undefined
  return { y, m: m - 1, d }
}

export type Renewal = { at: number; days: number; isEstimate: boolean }

/**
 * The next renewal on or after today: the configured day, or the day the
 * subscription was created (an estimate), moved on a month (or a year) at a
 * time; the day is kept, cut to the month's last where the month is shorter.
 */
export function nextRenewal(
  configured: string | undefined,
  createdAt: string | undefined,
  now: number,
  tzOffsetMin: number,
  billing: Billing = 'monthly',
): Renewal | undefined {
  const fromConfig = parseDay(configured)
  const anchor = fromConfig ?? parseDay(createdAt)
  if (anchor === undefined) return undefined
  const step = billing === 'yearly' ? 12 : 1
  const today = localDayOf(now, tzOffsetMin)
  const todayUtc = Date.UTC(today.y, today.m, today.d)
  let months = anchor.y * 12 + anchor.m
  const dayIn = (total: number) => {
    const y = Math.floor(total / 12)
    const m = total % 12
    return Date.UTC(y, m, Math.min(anchor.d, daysInMonth(y, m)))
  }
  let at = dayIn(months)
  for (let guard = 0; at < todayUtc && guard < 1200; guard++) {
    months += step
    at = dayIn(months)
  }
  return {
    at: at - tzOffsetMin * MINUTE,
    days: Math.round((at - todayUtc) / DAY),
    isEstimate: fromConfig === undefined,
  }
}

// ---------------------------------------------------------------- account

export function planLabel(organizationType: unknown, rateLimitTier: unknown): string | undefined {
  if (typeof organizationType !== 'string' || organizationType === '') return undefined
  const name = PLAN_NAMES[organizationType] ?? organizationType.replace(/^claude_/, '')
  const multiple = typeof rateLimitTier === 'string' ? rateLimitTier.match(/_(\d+x)$/)?.[1] : undefined
  return multiple === undefined ? name : `${name} ${multiple}`
}

/**
 * Reads, from `.claude.json`, the plan, the subscription's start, who pays,
 * and the id the figures are kept under; nothing else, and never a credential.
 */
export function profileFrom(text: string | undefined, tzOffsetMin: number, locale?: string): Profile {
  const profile: Profile = { tzOffsetMin }
  if (locale !== undefined && locale !== '') profile.locale = locale
  if (text === undefined) return profile
  try {
    const data: unknown = JSON.parse(text)
    const account = isObject(data) ? data.oauthAccount : undefined
    if (!isObject(account)) return profile
    const plan = planLabel(account.organizationType, account.organizationRateLimitTier)
    if (plan !== undefined) profile.plan = plan
    if (typeof account.subscriptionCreatedAt === 'string') profile.createdAt = account.subscriptionCreatedAt
    const id = typeof account.organizationUuid === 'string' ? account.organizationUuid : account.accountUuid
    if (typeof id === 'string' && id !== '') profile.account = id
    if (typeof account.organizationType === 'string' && ORGANIZATION_PLANS.has(account.organizationType)) {
      profile.isOrganizationBilled = true
    }
  } catch {
    // An unreadable file leaves the plan out.
  }
  return profile
}

/** `-0300` (what `date +%z` prints) as minutes east of UTC. */
export function parseOffset(text: string): number | undefined {
  const match = text.trim().match(/^([+-])(\d{2}):?(\d{2})$/)
  if (match === null) return undefined
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** The store key for a value of one account, so two accounts never mix. */
export function keyFor(base: string, profile: Profile | null): string {
  return profile?.account === undefined ? base : `${base}:${profile.account}`
}

// ---------------------------------------------------------------- stored values

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLimit(value: unknown): value is Limit {
  return (
    isObject(value) &&
    typeof value.kind === 'string' &&
    typeof value.percentUsed === 'number' &&
    (value.resetsAt === undefined || typeof value.resetsAt === 'string')
  )
}

export function isReading(value: unknown): value is Reading {
  return isObject(value) && typeof value.at === 'number' && Array.isArray(value.limits) && value.limits.every(isLimit)
}

export function isHistory(value: unknown): value is History {
  return (
    isObject(value) &&
    Object.values(value).every(
      track =>
        isObject(track) &&
        (track.resetsAt === null || typeof track.resetsAt === 'number') &&
        Array.isArray(track.samples) &&
        track.samples.every(s => isObject(s) && typeof s.t === 'number' && typeof s.p === 'number'),
    )
  )
}

export function isPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value)
}

/**
 * The placement to draw in: the one `/mk-usage` chose, while the configured
 * default is still the one it was chosen over; the configured default once
 * the person changed it after, so the newer intent wins.
 */
export function placementFrom(saved: unknown, configDefault: Placement): Placement {
  if (isObject(saved) && isPlacement(saved.value) && saved.configDefault === configDefault) return saved.value
  return configDefault
}

// ---------------------------------------------------------------- words

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function duration(ms: number): string {
  if (ms < MINUTE) return '<1m'
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h${pad2(minutes % 60)}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`
}

/**
 * A duration rounded so the line does not change every tick: 5-minute steps
 * under an hour, half hours under ten, whole hours under two days, then days
 * and hours.
 */
export function roughly(ms: number): string {
  const minutes = ms / MINUTE
  if (minutes < 60) return `~${Math.max(5, Math.round(minutes / 5) * 5)}m`
  if (minutes < 10 * 60) {
    const halves = Math.round(minutes / 30)
    const hours = Math.floor(halves / 2)
    return halves % 2 === 0 ? `~${hours}h` : `~${hours}h30m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `~${hours}h`
  return hours % 24 === 0 ? `~${hours / 24}d` : `~${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** `15:40`, or `3:40pm` in the 12-hour format. */
export function clockOf(ms: number, tzOffsetMin: number, format: TimeFormat = '24h'): string {
  const t = new Date(ms + tzOffsetMin * MINUTE)
  const hours = t.getUTCHours()
  const minutes = pad2(t.getUTCMinutes())
  if (format === '24h') return `${pad2(hours)}:${minutes}`
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes}${hours < 12 ? 'am' : 'pm'}`
}

export function dateOf(ms: number, tzOffsetMin: number, words: Words = DEFAULT_PREFS.words): string {
  const t = new Date(ms + tzOffsetMin * MINUTE)
  return words.dayMonth(t.getUTCDate(), words.months[t.getUTCMonth()] ?? '')
}

/** `15:40`, `mañana 15:40`, `jue 16 10:00` or `2 nov 10:00`, by distance. */
export function whenOf(
  ms: number,
  now: number,
  tzOffsetMin: number,
  words: Words = DEFAULT_PREFS.words,
  format: TimeFormat = '24h',
): string {
  const day = localDayOf(ms, tzOffsetMin)
  const today = localDayOf(now, tzOffsetMin)
  const apart = Math.round((Date.UTC(day.y, day.m, day.d) - Date.UTC(today.y, today.m, today.d)) / DAY)
  const clock = clockOf(ms, tzOffsetMin, format)
  if (apart === 0) return clock
  if (apart === 1) return `${words.tomorrow} ${clock}`
  if (apart > 1 && apart < 7) {
    const weekday = new Date(ms + tzOffsetMin * MINUTE).getUTCDay()
    return `${words.days[weekday]} ${day.d} ${clock}`
  }
  return `${dateOf(ms, tzOffsetMin, words)} ${clock}`
}

function number(n: number): string {
  return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n))
}

export function rateLabel(ratePerHour: number, kind: string, words: Words = DEFAULT_PREFS.words): string {
  return isShort(kind) ? `${number(ratePerHour)}${words.perHour}` : `${number(ratePerHour * 24)}${words.perDay}`
}

// ---------------------------------------------------------------- layouts
//
// The state: `ok` reaches the reset fine, `warn` arrives tight, `bad` runs out
// first. Where the row keeps colors (the band, the pane) the theme paints it;
// in the footer the words carry it. What is secondary is `muted`, the gray of
// Claude's own footer. Only words, digits, `~`, `·` and `│`: arrows such as
// ↻ and → draw over the next cell in some fonts.

export type Tone = 'text' | 'muted' | 'ok' | 'warn' | 'bad'
export type Segment = { text: string; tone: Tone; isBold?: boolean }
export type Row = Segment[]
export type Status = 'ok' | 'warn' | 'bad'

export type View = {
  reading: Reading
  history: History
  profile: Profile | null
  prefs: Prefs
  now: number
}

type Window = {
  limit: Limit
  label: string
  resetsAt: number | undefined
  isReset: boolean
  projection: Projection
  status: Status
}

/**
 * Bad: runs out before the reset, or past `criticalPercent`. Warn: reaches
 * `warnPercent` by the reset, or already has.
 */
export function statusOf(
  percentUsed: number,
  projection: Projection,
  prefs: Pick<Prefs, 'warnPercent' | 'criticalPercent'> = DEFAULT_PREFS,
): Status {
  if (projection.kind === 'exhausts' || projection.kind === 'exhausted' || percentUsed >= prefs.criticalPercent) return 'bad'
  const ends = projection.kind === 'atReset' ? projection.percent : percentUsed
  if (Math.max(ends, percentUsed) >= prefs.warnPercent) return 'warn'
  return 'ok'
}

function windowsOf(view: View): Window[] {
  return sortLimits(view.reading.limits).map(limit => {
    const resetsAt = resetsAtMs(limit)
    const isReset = resetsAt !== undefined && resetsAt <= view.now
    const projection = project(limit, view.history[limit.kind]?.samples ?? [], view.now)
    return {
      limit,
      label: labelOf(limit.kind, view.prefs.words),
      resetsAt,
      isReset,
      projection,
      status: isReset ? 'ok' : statusOf(limit.percentUsed, projection, view.prefs),
    }
  })
}

const muted = (text: string): Segment => ({ text, tone: 'muted' })
const plain = (text: string): Segment => ({ text, tone: 'text' })

function join(groups: Row[], separator: Segment): Row {
  return groups.flatMap((group, i) => (i === 0 ? group : [separator, ...group]))
}

/** How old the reading is, once old enough to say so. */
function ageOf(view: View): string | undefined {
  const age = view.now - view.reading.at
  return age >= STALE_AFTER ? roughly(age).slice(1) : undefined
}

/**
 * The renewal to show: none when the person hid it, nor an estimate where an
 * organization pays (Team, Enterprise), whose renewal is not the account's.
 */
function renewalOf(view: View): Renewal | undefined {
  const { prefs, profile } = view
  if (!prefs.showRenewal) return undefined
  const createdAt = profile?.isOrganizationBilled === true ? undefined : profile?.createdAt
  return nextRenewal(prefs.renewalDate, createdAt, view.now, profile?.tzOffsetMin ?? 0, prefs.billing)
}

export function textOf(row: Row): string {
  return row.map(s => s.text).join('')
}

function percentSegment(w: Window): Segment {
  return { text: `${Math.round(w.limit.percentUsed)}%`, tone: w.status, isBold: true }
}

function warnTone(percent: number, prefs: Prefs): Tone {
  return percent >= prefs.warnPercent ? 'warn' : 'muted'
}

/**
 * The estimate after a window's percent: where it ends at the reset, or when
 * it runs out; with `withReset`, when the window resets as well.
 */
function estimateOf(w: Window, view: View, withReset: boolean): Row {
  const { words, timeFormat } = view.prefs
  const tz = view.profile?.tzOffsetMin ?? 0
  if (w.isReset) return [muted(words.wasReset)]
  const p = w.projection
  const at = w.resetsAt === undefined ? undefined : whenOf(w.resetsAt, view.now, tz, words, timeFormat)
  if (p.kind === 'exhausts') {
    const row: Row = [{ text: words.runsOutIn(roughly(p.inMs)), tone: 'bad' }]
    if (withReset && at !== undefined) row.push(muted(` (${words.resets(at)})`))
    return row
  }
  if (p.kind === 'exhausted') {
    const until = w.resetsAt === undefined ? words.usedUp : words.usedUpUntil(clockOf(w.resetsAt, tz, timeFormat))
    return [{ text: until, tone: 'bad' }]
  }
  if (p.kind === 'atReset') {
    const row: Row = [{ text: words.atReset(p.percent), tone: warnTone(p.percent, view.prefs) }]
    if (withReset && at !== undefined) row.push(muted(` (${at})`))
    return row
  }
  if (withReset && at !== undefined) return [muted(words.resets(at))]
  return []
}

/**
 * Where the row is drawn. `footer`: after Claude's own hint under the prompt,
 * a line the engine paints in its gray, so the words carry the state and the
 * spacing is tight. `band`: a row of its own, in the theme's colors.
 */
export type Style = 'footer' | 'band'

const SPACING: Record<Style, { afterLabel: string; divider: Segment }> = {
  footer: { afterLabel: ' ', divider: muted(' │ ') },
  band: { afterLabel: '  ', divider: muted('  │  ') },
}

function daysLeft(renewal: Renewal, words: Words): string {
  if (renewal.days === 0) return words.today
  if (renewal.days === 1) return words.tomorrow
  return words.inDays(`${renewal.isEstimate ? '≈' : ''}${renewal.days}`)
}

function renewalBlock(renewal: Renewal, words: Words, afterLabel: string): Row {
  return [plain(`${words.renews}${afterLabel}`), { text: daysLeft(renewal, words), tone: 'text', isBold: true }]
}

/** The estimate in a few characters, `(~73%)` or `(se agota ~2h)`, for a short row. */
function compactEstimateOf(w: Window, prefs: Prefs): Row {
  const p = w.projection
  if (p.kind === 'exhausts') return [{ text: ` (${prefs.words.runsOutShort(roughly(p.inMs))})`, tone: 'bad' }]
  if (p.kind === 'exhausted') return [{ text: ` (${prefs.words.usedUp})`, tone: 'bad' }]
  if (p.kind === 'atReset') return [{ text: ` (~${p.percent}%)`, tone: warnTone(p.percent, prefs) }]
  return []
}

/**
 * How much a row carries. `estimate` is the words; `compact`, `(~73%)`;
 * `Alerts` keeps the estimate only for windows that are tight or run out;
 * `Only` leaves the renewal out.
 */
type Detail =
  | 'full'
  | 'estimate'
  | 'estimateOnly'
  | 'compact'
  | 'compactOnly'
  | 'compactAlerts'
  | 'compactAlertsOnly'
  | 'runsOutOnly'
  | 'bare'

function line(view: View, windows: Window[], detail: Detail, style: Style): Row {
  const { words } = view.prefs
  const { afterLabel, divider } = SPACING[style]
  const blocks = windows.map((w): Row => {
    // A window past its reset has no figure yet: its old percent would mislead.
    if (w.isReset) return [plain(`${w.label}${afterLabel}`), muted(words.wasReset)]
    const block: Row = [plain(`${w.label}${afterLabel}`), percentSegment(w)]
    if (detail === 'compact' || detail === 'compactOnly') return [...block, ...compactEstimateOf(w, view.prefs)]
    if (detail === 'compactAlerts' || detail === 'compactAlertsOnly') {
      return w.status === 'ok' ? block : [...block, ...compactEstimateOf(w, view.prefs)]
    }
    if (detail === 'runsOutOnly') {
      const p = w.projection
      return p.kind === 'exhausts' ? [...block, { text: ` (${words.runsOutTiny(roughly(p.inMs))})`, tone: 'bad' }] : block
    }
    if (detail === 'full' || detail === 'estimate' || detail === 'estimateOnly') {
      const estimate = estimateOf(w, view, detail === 'full')
      if (estimate.length > 0) block.push(muted(' · '), ...estimate)
    }
    return block
  })
  if (detail === 'full' || detail === 'estimate' || detail === 'compact' || detail === 'compactAlerts') {
    const renewal = renewalOf(view)
    if (renewal !== undefined) blocks.push(renewalBlock(renewal, words, afterLabel))
  }
  if (detail === 'full' || detail === 'estimate') {
    const age = ageOf(view)
    if (age !== undefined) blocks.push([muted(words.dataFrom(age))])
  }
  return join(blocks, divider)
}

/**
 * One row of named blocks, `Sesión 5h │ Semana │ Renueva`, that fits `width`
 * columns, richest first. What goes first as room runs out: the reset times,
 * the estimates' words (`(~73%)` in their place), the renewal, the estimates
 * of the windows that are fine, those of the tight ones; the warning of a
 * window that runs out goes last, in its fewest words, before the named
 * percentages alone.
 */
export function fitLine(view: View, width: number, style: Style = 'band'): Row {
  const windows = windowsOf(view)
  if (windows.length === 0) return []
  const details = [
    'full',
    'estimate',
    'estimateOnly',
    'compact',
    'compactOnly',
    'compactAlerts',
    'compactAlertsOnly',
    'runsOutOnly',
    'bare',
  ] as const
  const variants = details.map(detail => line(view, windows, detail, style))
  return variants.find(row => textOf(row).length <= width) ?? variants[variants.length - 1] ?? []
}

/** The detail `/mk-usage` shows: a header, then two rows per window. */
export function detailRows(view: View): Row[] {
  const { words, timeFormat } = view.prefs
  const tz = view.profile?.tzOffsetMin ?? 0
  const windows = windowsOf(view)
  const renewal = renewalOf(view)
  const header: Row[] = []
  if (view.profile?.plan !== undefined) header.push([{ text: view.profile.plan, tone: 'text', isBold: true }])
  if (renewal !== undefined) {
    const date = `${renewal.isEstimate ? '≈' : ''}${dateOf(renewal.at, tz, words)}`
    const left = renewal.days === 0 ? words.today : renewal.days === 1 ? words.tomorrow : words.inDays(String(renewal.days))
    header.push([muted(words.renewsOn(date, left))])
  }
  const age = ageOf(view)
  if (age !== undefined) header.push([muted(words.dataFrom(age))])

  // A short indent: the pane docks as a narrow sidebar, and the second row must fit.
  const width = Math.max(0, ...windows.map(w => w.label.length))
  const indent = '  '
  const gap = plain('  ')
  const rows = windows.flatMap((w): Row[] => {
    const first: Row = [plain(`${w.label.padEnd(width)}  `), percentSegment(w)]
    const p = w.projection
    if (w.isReset) return [[...first, gap, muted(words.wasResetLong)]]
    if (p.kind === 'exhausts') {
      first.push(gap, { text: `${words.runsOutIn(roughly(p.inMs))} (${whenOf(p.at, view.now, tz, words, timeFormat)})`, tone: 'bad' })
    } else if (p.kind === 'atReset') {
      first.push(gap, { text: words.atReset(p.percent), tone: warnTone(p.percent, view.prefs) })
    } else if (p.kind === 'exhausted') {
      first.push(gap, { text: words.usedUp, tone: 'bad' })
    } else if (p.kind === 'idle') {
      first.push(gap, muted(words.idle))
    }
    const second: string[] = []
    if (w.resetsAt !== undefined) {
      second.push(words.resetsIn(whenOf(w.resetsAt, view.now, tz, words, timeFormat), duration(w.resetsAt - view.now)))
    }
    if (p.kind === 'exhausts' || p.kind === 'atReset') second.push(words.pace(rateLabel(p.ratePerHour, w.limit.kind, words)))
    return second.length === 0 ? [first] : [first, [muted(indent + second.join(' · '))]]
  })
  const footnote: Row[] = renewal?.isEstimate === true ? [[muted(words.estimateHint)]] : []
  return [...(header.length === 0 ? [] : [join(header, muted(' · '))]), ...rows, ...footnote]
}
