// Every word mk-usage shows, per language. The rest of the mod never spells
// one itself, so a language is this table and nothing else.

import type { Check, GitHubState, GitOperation, Placement } from '../types'

export type Language = 'es' | 'en'

/** The words of the git and GitHub row, its detail and the commit dialog. */
export type GitWords = {
  clean: string
  staged: (n: number) => string
  modified: (n: number) => string
  untracked: (n: number) => string
  conflicts: (n: number) => string
  changes: (n: number) => string
  toPush: (n: number) => string
  toPull: (n: number) => string
  upToDate: string
  /** Commits on no remote, for a branch without an upstream. */
  notPushed: (n: number) => string
  /** A branch without an upstream and nothing to count. */
  branchNotPushed: string
  noRemote: string
  detached: string
  noCommits: string
  operations: Record<GitOperation, string>
  stashed: (n: number) => string
  ciOk: string
  ciFailing: (failed: number, total: number) => string
  ciRunning: (running: number, total: number) => string
  ciFailingShort: string
  ciRunningShort: string
  /** Checks that belong to an older commit than the one checked out. */
  ciOlder: string
  prMerged: string
  prClosed: string
  unreleased: (tag: string, n: number) => string
  releasePending: (version: string) => string
  changelogStale: string
  commitButton: string

  section: string
  lastCommit: (hash: string, ago: string, subject: string) => string
  ago: (duration: string) => string
  upstream: (name: string) => string
  noUpstream: string
  sinceTag: (tag: string, n: number) => string
  noTags: string
  changelogStaleSince: (file: string, tag: string) => string
  changelogTouched: (file: string) => string
  slow: string
  noPr: string
  pr: (n: number, title: string) => string
  prDraft: string
  checksOf: (sha: string) => string
  checkStates: Record<Check['state'], string>
  unavailable: Record<NonNullable<GitHubState['unavailable']>, string>
  notRepo: string

  commitIn: (branch: string) => string
  stagedFiles: (n: number) => string
  unstagedLeft: (n: number) => string
  moreFiles: (n: number) => string
  nothingStaged: string
  stageAll: string
  /** Under the dialog's title while the keys are elsewhere (the band, the prompt). */
  focusHint: string
  subject: string
  body: string
  confirm: string
  generate: string
  cancel: string
  generating: string
  committing: string
  committed: (hash: string, subject: string) => string
  commitFailed: (why: string) => string
  /** The Bash tool refused the commit (permissions, auto mode). */
  commitDenied: string
  generated: (tokens: number) => string
  generateFailed: (why: string) => string
  emptySubject: string
  refreshed: string
  movedTo: Record<Placement, string>

  draftAdd: (name: string) => string
  draftRemove: (name: string) => string
  draftRename: (name: string) => string
  draftUpdate: (name: string) => string
  draftFiles: (n: number) => string
  draftDocs: string
  draftTests: string
  draftCi: string
  draftDeps: string
  /** The language Claude is asked to write the message in, by name. */
  aiLanguage: string
}

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
  /** The other words `/mk-usage` takes: the commit dialog, a refresh, the git row's placement. */
  commandWords: { detail: string; commit: string; refresh: string; git: string }
  git: GitWords
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const GIT_ES: GitWords = {
  clean: 'limpio',
  staged: n => plural(n, 'preparado', 'preparados'),
  modified: n => plural(n, 'modificado', 'modificados'),
  untracked: n => plural(n, 'nuevo', 'nuevos'),
  conflicts: n => `${n} en conflicto`,
  changes: n => plural(n, 'cambio', 'cambios'),
  toPush: n => `subir ${n}`,
  toPull: n => `bajar ${n}`,
  upToDate: 'al día',
  notPushed: n => `${n} sin subir`,
  branchNotPushed: 'rama sin subir',
  noRemote: 'sin remoto',
  detached: 'HEAD separado',
  noCommits: 'sin commits',
  operations: {
    merge: 'merge en curso',
    rebase: 'rebase en curso',
    'cherry-pick': 'cherry-pick en curso',
    revert: 'revert en curso',
    bisect: 'bisect en curso',
  },
  stashed: n => `${n} en stash`,
  ciOk: 'CI ok',
  ciFailing: (failed, total) => `CI falla ${failed}/${total}`,
  ciRunning: (running, total) => `CI corriendo ${running}/${total}`,
  ciFailingShort: 'CI falla',
  ciRunningShort: 'CI corriendo',
  ciOlder: 'de un commit anterior',
  prMerged: 'PR fusionado',
  prClosed: 'PR cerrado',
  unreleased: (tag, n) => `${tag} +${n} sin publicar`,
  releasePending: version => `v${version} pendiente`,
  changelogStale: 'CHANGELOG sin tocar',
  commitButton: 'commit',

  section: 'Git',
  lastCommit: (hash, ago, subject) => `último commit ${hash} ${ago}: ${subject}`,
  ago: d => `hace ${d}`,
  upstream: name => `sigue a ${name}`,
  noUpstream: 'sin upstream',
  sinceTag: (tag, n) => `${tag} · ${plural(n, 'commit', 'commits')} sin publicar`,
  noTags: 'sin versiones publicadas',
  changelogStaleSince: (file, tag) => `${file} sin tocar desde ${tag}`,
  changelogTouched: file => `${file} al día`,
  slow: 'repositorio lento: sin contar archivos nuevos',
  noPr: 'sin PR',
  pr: (n, title) => `PR #${n}: ${title}`,
  prDraft: 'borrador',
  checksOf: sha => `checks de ${sha}`,
  checkStates: { ok: 'ok', failed: 'falla', running: 'corriendo', skipped: 'omitido' },
  unavailable: {
    'gh-missing': 'GitHub: instalá gh para ver PR y CI',
    'gh-auth': 'GitHub: gh auth login para ver PR y CI',
    'not-github': 'el remoto no es de GitHub',
    failed: 'GitHub no respondió; se reintenta',
    off: 'GitHub desactivado (git_github)',
  },
  notRepo: 'No es un repositorio git.',

  commitIn: branch => `Commit en ${branch}`,
  stagedFiles: n => plural(n, 'archivo preparado', 'archivos preparados'),
  unstagedLeft: n => `${n} sin preparar`,
  moreFiles: n => `y ${n} más`,
  nothingStaged: 'Nada preparado todavía.',
  stageAll: 'Preparar todo',
  focusHint: 'ctrl+x tab para escribir acá',
  subject: 'Título',
  body: 'Cuerpo',
  confirm: 'Confirmar',
  generate: 'Generar con Claude',
  cancel: 'Cancelar',
  generating: 'Claude está escribiendo el mensaje...',
  committing: 'Haciendo el commit...',
  committed: (hash, subject) => `Commit ${hash}: ${subject}`,
  commitFailed: why => `No se pudo hacer el commit: ${why}`,
  commitDenied:
    'Claude Code no dejó correr el commit por Bash (permisos o modo auto). Aprobalo cuando lo pida, o usá git_commit_via=direct (sin los hooks del repositorio).',
  generated: tokens => `Mensaje de Claude (${tokens} tokens)`,
  generateFailed: why => `Claude no pudo escribirlo: ${why}`,
  emptySubject: 'Falta el título.',
  refreshed: 'Git y GitHub actualizados',
  movedTo: {
    footer: 'Git al final de la línea bajo el prompt',
    band: 'Git en una fila propia sobre el prompt, con colores',
    hidden: 'Git oculto: /mk-usage muestra el detalle',
  },

  draftAdd: name => `agregar ${name}`,
  draftRemove: name => `quitar ${name}`,
  draftRename: name => `renombrar ${name}`,
  draftUpdate: name => `actualizar ${name}`,
  draftFiles: n => `actualizar ${n} archivos`,
  draftDocs: 'actualizar la documentación',
  draftTests: 'actualizar los tests',
  draftCi: 'actualizar el CI',
  draftDeps: 'actualizar dependencias',
  aiLanguage: 'español',
}

const GIT_EN: GitWords = {
  clean: 'clean',
  staged: n => `${n} staged`,
  modified: n => `${n} modified`,
  untracked: n => `${n} untracked`,
  conflicts: n => `${n} conflicted`,
  changes: n => plural(n, 'change', 'changes'),
  toPush: n => `${n} to push`,
  toPull: n => `${n} to pull`,
  upToDate: 'up to date',
  notPushed: n => `${n} not pushed`,
  branchNotPushed: 'branch not pushed',
  noRemote: 'no remote',
  detached: 'detached HEAD',
  noCommits: 'no commits',
  operations: {
    merge: 'merge in progress',
    rebase: 'rebase in progress',
    'cherry-pick': 'cherry-pick in progress',
    revert: 'revert in progress',
    bisect: 'bisect in progress',
  },
  stashed: n => `${n} stashed`,
  ciOk: 'CI ok',
  ciFailing: (failed, total) => `CI failing ${failed}/${total}`,
  ciRunning: (running, total) => `CI running ${running}/${total}`,
  ciFailingShort: 'CI failing',
  ciRunningShort: 'CI running',
  ciOlder: 'of an older commit',
  prMerged: 'PR merged',
  prClosed: 'PR closed',
  unreleased: (tag, n) => `${tag} +${n} unreleased`,
  releasePending: version => `v${version} pending`,
  changelogStale: 'CHANGELOG untouched',
  commitButton: 'commit',

  section: 'Git',
  lastCommit: (hash, ago, subject) => `last commit ${hash} ${ago}: ${subject}`,
  ago: d => `${d} ago`,
  upstream: name => `tracks ${name}`,
  noUpstream: 'no upstream',
  sinceTag: (tag, n) => `${tag} · ${plural(n, 'commit', 'commits')} unreleased`,
  noTags: 'no releases yet',
  changelogStaleSince: (file, tag) => `${file} untouched since ${tag}`,
  changelogTouched: file => `${file} up to date`,
  slow: 'slow repository: untracked files not counted',
  noPr: 'no PR',
  pr: (n, title) => `PR #${n}: ${title}`,
  prDraft: 'draft',
  checksOf: sha => `checks of ${sha}`,
  checkStates: { ok: 'ok', failed: 'failing', running: 'running', skipped: 'skipped' },
  unavailable: {
    'gh-missing': 'GitHub: install gh to see PRs and CI',
    'gh-auth': 'GitHub: run gh auth login to see PRs and CI',
    'not-github': 'the remote is not on GitHub',
    failed: 'GitHub did not answer; retrying',
    off: 'GitHub turned off (git_github)',
  },
  notRepo: 'Not a git repository.',

  commitIn: branch => `Commit on ${branch}`,
  stagedFiles: n => plural(n, 'staged file', 'staged files'),
  unstagedLeft: n => `${n} not staged`,
  moreFiles: n => `and ${n} more`,
  nothingStaged: 'Nothing staged yet.',
  stageAll: 'Stage all',
  focusHint: 'ctrl+x tab to type here',
  subject: 'Subject',
  body: 'Body',
  confirm: 'Commit',
  generate: 'Write with Claude',
  cancel: 'Cancel',
  generating: 'Claude is writing the message...',
  committing: 'Committing...',
  committed: (hash, subject) => `Commit ${hash}: ${subject}`,
  commitFailed: why => `The commit failed: ${why}`,
  commitDenied:
    'Claude Code did not let the commit run through Bash (permissions or auto mode). Approve it when asked, or set git_commit_via=direct (without the repository\'s hooks).',
  generated: tokens => `Message by Claude (${tokens} tokens)`,
  generateFailed: why => `Claude could not write it: ${why}`,
  emptySubject: 'The subject is empty.',
  refreshed: 'Git and GitHub refreshed',
  movedTo: {
    footer: 'Git at the end of the line under the prompt',
    band: 'Git on a row of its own above the prompt, in color',
    hidden: 'Git hidden: /mk-usage shows the detail',
  },

  draftAdd: name => `add ${name}`,
  draftRemove: name => `remove ${name}`,
  draftRename: name => `rename ${name}`,
  draftUpdate: name => `update ${name}`,
  draftFiles: n => `update ${n} files`,
  draftDocs: 'update the docs',
  draftTests: 'update the tests',
  draftCi: 'update CI',
  draftDeps: 'update dependencies',
  aiLanguage: 'English',
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
  commandDescription: 'mk-usage: detalle de la cuota y de git, commit, o dónde mostrarlos (pie, franja, oculto)',
  usage: words => `Uso: /mk-usage [${words}], o sin nada para ver el detalle`,
  placementNames: { footer: 'pie', band: 'franja', hidden: 'oculto' },
  movedTo: {
    footer: 'Al final de la línea bajo el prompt, sin fila propia',
    band: 'Una fila propia sobre el prompt, con colores',
    hidden: 'Oculto: /mk-usage muestra el detalle cuando lo pidas',
  },
  commandWords: { detail: 'detalle', commit: 'commit', refresh: 'actualizar', git: 'git' },
  git: GIT_ES,
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
  commandDescription: 'mk-usage: quota and git detail, commit, or where to show them (footer, band, hidden)',
  usage: words => `Usage: /mk-usage [${words}], or nothing for the detail`,
  placementNames: { footer: 'footer', band: 'band', hidden: 'hidden' },
  movedTo: {
    footer: 'At the end of the line under the prompt, no row of its own',
    band: 'A row of its own above the prompt, in color',
    hidden: 'Hidden: /mk-usage shows the detail when you ask',
  },
  commandWords: { detail: 'detail', commit: 'commit', refresh: 'refresh', git: 'git' },
  git: GIT_EN,
}

export const WORDS: Record<Language, Words> = { es: ES, en: EN }

/** `es` for a Spanish locale (`es_AR.UTF-8`, `es-419`), `en` for any other or none. */
export function languageOf(locale: string | undefined): Language {
  return locale !== undefined && /^es([_.@-]|$)/i.test(locale) ? 'es' : 'en'
}
