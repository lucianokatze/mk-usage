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

declare module 'claude-code' {
  interface PluginState {
    'mk-usage': {
      reading: Reading | null
      history: History
      profile: Profile | null
      placement: Placement
    }
  }
}
