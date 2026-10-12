// Every word mk-usage shows, per language. The rest of the mod never spells
// one itself, so a language is this table and nothing else.

export type Language = 'es' | 'en'

export type Words = {
  /** Block names: the 5-hour session, the week, a model's own week, a gateway's spend limit. */
  session: string
  week: string
  weekOf: (model: string) => string
  spend: string
  renews: string

  days: readonly string[]
  months: readonly string[]
  /** A calendar day: `2 nov` or `Nov 2`. */
  dayMonth: (day: number, month: string) => string
  tomorrow: string
  today: string
  inDays: (days: string) => string

  atReset: (percent: number) => string
  runsOutIn: (duration: string) => string
  runsOutShort: (duration: string) => string
  /** The fewest words a running-out warning takes, for the narrowest row. */
  runsOutTiny: (duration: string) => string
  usedUp: string
  usedUpUntil: (clock: string) => string
  wasReset: string
  wasResetLong: string
  resets: (when: string) => string
  resetsIn: (when: string, left: string) => string
  pace: (rate: string) => string
  perHour: string
  perDay: string
  idle: string
  ago: (duration: string) => string
  dataFrom: (duration: string) => string
  renewsOn: (date: string, left: string) => string
  estimateHint: string

  noData: string
  escCloses: string
  commandDescription: string
  usage: (words: string) => string
  /** The placement words `/mk-usage` takes in this language (it takes both). */
  placementNames: { footer: string; band: string; hidden: string }
  movedTo: { footer: string; band: string; hidden: string }
}

const ES: Words = {
  session: 'Sesión 5h',
  week: 'Semana',
  weekOf: model => `Semana ${model}`,
  spend: 'Gasto',
  renews: 'Renueva',

  days: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  dayMonth: (day, month) => `${day} ${month}`,
  tomorrow: 'mañana',
  today: 'hoy',
  inDays: days => `en ${days} d`,

  atReset: percent => `~${percent}% al reinicio`,
  runsOutIn: duration => `se agota en ${duration}`,
  runsOutShort: duration => `se agota ${duration}`,
  runsOutTiny: duration => `agota ${duration}`,
  usedUp: 'agotada',
  usedUpUntil: clock => `agotada hasta ${clock}`,
  wasReset: 'reiniciada',
  wasResetLong: 'reiniciada, sin dato nuevo todavía',
  resets: when => `reinicia ${when}`,
  resetsIn: (when, left) => `reinicia ${when} (en ${left})`,
  pace: rate => `ritmo ${rate}`,
  perHour: '%/h',
  perDay: '%/día',
  idle: 'sin uso reciente',
  ago: duration => `hace ${duration}`,
  dataFrom: duration => `dato de hace ${duration}`,
  renewsOn: (date, left) => `renueva el ${date} (${left})`,
  estimateHint: '≈ estimada: poné la fecha real en /plugin configure mk-usage',

  noData: 'Sin datos todavía: llegan con la primera respuesta de Claude en la sesión.',
  escCloses: 'Esc cierra',
  commandDescription: 'mk-usage: detalle de la cuota, o dónde mostrarla (pie, franja, oculto)',
  usage: words => `Uso: /mk-usage [${words}], o sin nada para ver el detalle`,
  placementNames: { footer: 'pie', band: 'franja', hidden: 'oculto' },
  movedTo: {
    footer: 'Al final de la línea bajo el prompt, sin fila propia',
    band: 'Una fila propia sobre el prompt, con colores',
    hidden: 'Oculto: /mk-usage muestra el detalle cuando lo pidas',
  },
}

const EN: Words = {
  session: 'Session 5h',
  week: 'Week',
  weekOf: model => `Week ${model}`,
  spend: 'Spend',
  renews: 'Renews',

  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  dayMonth: (day, month) => `${month} ${day}`,
  tomorrow: 'tomorrow',
  today: 'today',
  inDays: days => `in ${days} d`,

  atReset: percent => `~${percent}% at reset`,
  runsOutIn: duration => `runs out in ${duration}`,
  runsOutShort: duration => `runs out ${duration}`,
  runsOutTiny: duration => `out ${duration}`,
  usedUp: 'used up',
  usedUpUntil: clock => `used up until ${clock}`,
  wasReset: 'reset',
  wasResetLong: 'reset, no new figure yet',
  resets: when => `resets ${when}`,
  resetsIn: (when, left) => `resets ${when} (in ${left})`,
  pace: rate => `pace ${rate}`,
  perHour: '%/h',
  perDay: '%/day',
  idle: 'no recent use',
  ago: duration => `${duration} ago`,
  dataFrom: duration => `data from ${duration} ago`,
  renewsOn: (date, left) => `renews ${date} (${left})`,
  estimateHint: '≈ estimated: set the real date in /plugin configure mk-usage',

  noData: 'No data yet: it arrives with Claude’s first response in the session.',
  escCloses: 'Esc closes',
  commandDescription: 'mk-usage: quota detail, or where to show it (footer, band, hidden)',
  usage: words => `Usage: /mk-usage [${words}], or nothing for the detail`,
  placementNames: { footer: 'footer', band: 'band', hidden: 'hidden' },
  movedTo: {
    footer: 'At the end of the line under the prompt, no row of its own',
    band: 'A row of its own above the prompt, in color',
    hidden: 'Hidden: /mk-usage shows the detail when you ask',
  },
}

export const WORDS: Record<Language, Words> = { es: ES, en: EN }

/** `es` for a Spanish locale (`es_AR.UTF-8`, `es-419`), `en` for any other or none. */
export function languageOf(locale: string | undefined): Language {
  return locale !== undefined && /^es([_.@-]|$)/i.test(locale) ? 'es' : 'en'
}
