/** One rate-limit window as `$.session.usage()` reports it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The last non-empty set of windows a response reported, and when (ms). */
export type Reading = { at: number; limits: Limit[] }

/** One point of a window's fill over time: `t` in ms, `p` in percent. */
export type Sample = { t: number; p: number }

/** The samples of the current cycle of one window, keyed by its kind. */
export type Track = { resetsAt: number | null; samples: Sample[] }
export type History = { [kind: string]: Track }

/**
 * Facts of the machine and the account, read at the session's start and every
 * hour after (a daylight-saving change, a /login to another account):
 * `tzOffsetMin` is minutes east of UTC; `locale` the system's (`LANG`);
 * `account` the organization or account id the stored figures are kept under;
 * `isOrganizationBilled` true on Team and Enterprise, whose renewal is the
 * organization's and is never estimated.
 */
export type Profile = {
  tzOffsetMin: number
  locale?: string
  plan?: string
  createdAt?: string
  account?: string
  isOrganizationBilled?: boolean
}

/**
 * Where the one-row summary goes: `footer`, the end of the hint line under
 * the prompt, no row of its own, in Claude's gray; `band`, a row of its own
 * above the prompt, in color; `hidden`, none (the detail on `/mk-usage` only).
 */
export type Placement = 'footer' | 'band' | 'hidden'

/** The placement `/mk-usage` last chose, and the configured default it was chosen over. */
export type PlacementChoice = { value: Placement; configDefault: Placement }

/** The files of the working tree by state, as `git status` counts them. */
export type GitFiles = { staged: number; modified: number; untracked: number; conflicts: number }

/** An operation git left half done, waiting for the person. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

/**
 * The repository the session works in, read with git alone (no network):
 * `branch` null on a detached HEAD, `oid` null before the first commit;
 * `ahead`/`behind` against `upstream`; `unpushed`, without an upstream, the
 * commits on no remote; `remotes` the remotes' URLs; `tag` the last release
 * tag and `sinceTag` the commits after it; `changelogTouched` whether the
 * changelog changed since that tag (null: no tag or no changelog); `version`
 * the manifest's (`.claude-plugin/plugin.json` or `package.json`).
 */
export type GitState = {
  root: string
  branch: string | null
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  unpushed: number | null
  remotes: string[]
  files: GitFiles
  stash: number
  operation: GitOperation | null
  tag: string | null
  sinceTag: number
  changelogTouched: boolean | null
  version: string | null
  lastCommit: { hash: string; subject: string; at: number } | null
  isSlow: boolean
  at: number
}

/** One CI check as GitHub reports it, reduced to what the row says. */
export type Check = { name: string; state: 'ok' | 'failed' | 'running' | 'skipped'; url?: string }

/** The pull request of the branch, when it has one. */
export type PullRequest = { number: number; title: string; url: string; state: 'open' | 'merged' | 'closed'; isDraft: boolean }

/**
 * What GitHub says of the branch, through `gh`: its pull request and the
 * checks of `checksSha` (the PR's head, or the branch's last workflow runs).
 * `unavailable` says why there is nothing: no `gh`, not logged in, the remote
 * is not GitHub's, a failed call, or the option turned off.
 */
export type GitHubState = {
  root: string
  branch: string | null
  pr: PullRequest | null
  checks: Check[]
  checksSha: string | null
  unavailable: 'gh-missing' | 'gh-auth' | 'not-github' | 'failed' | 'off' | null
  at: number
}

/** A file in the commit dialog: git's letter (`A`, `M`, `D`, `R`…) and its path. */
export type StagedFile = { status: string; path: string }

/**
 * The commit dialog: the staged files, what is left unstaged, the message
 * being written, and what is running (`generating` with Claude, `committing`).
 */
export type CommitDraft = {
  files: StagedFile[]
  unstaged: number
  subject: string
  body: string
  busy: 'generating' | 'committing' | null
  note: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mk-usage': {
      reading: Reading | null
      history: History
      profile: Profile | null
      placement: Placement
      git: GitState | null
      github: GitHubState | null
      gitPlacement: Placement
      commit: CommitDraft | null
    }
  }
}
