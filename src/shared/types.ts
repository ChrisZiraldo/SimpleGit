export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; code: number; stderr: string }
export type Result<T> = Ok<T> | Err

export interface RecentRepo {
  path: string
  name: string
  lastOpenedAt: number
}

export type FileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unmerged'

export interface FileEntry {
  path: string
  origPath?: string
  staged: boolean
  unstaged: boolean
  changeType: FileChangeType
  stagedCode?: string
  unstagedCode?: string
}

export interface BranchInfo {
  current: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
}

export interface StatusResult {
  branch: BranchInfo
  staged: FileEntry[]
  unstaged: FileEntry[]
  untracked: FileEntry[]
  conflicted: FileEntry[]
}

export interface Branch {
  name: string
  current: boolean
  remote: boolean
  upstream: string | null
}

export interface Commit {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  relativeDate: string
  subject: string
}

export interface CommitInput {
  message: string
  description?: string
  /** When true, amends the most recent commit instead of creating a new one. */
  amend?: boolean
}

export interface PrCreateOptions {
  base: string
  head: string
  title: string
  body?: string
  draft?: boolean
}

export interface PrReviewOptions {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body?: string
}

export interface ConflictVersions {
  path: string
  base: string
  ours: string
  theirs: string
}

export type RebaseAction = 'pick' | 'squash' | 'fixup' | 'drop'

export interface RebasePlanEntry {
  sha: string
  action: RebaseAction
  subject?: string
}

export interface RebaseStatus {
  inProgress: boolean
  head: string | null
  onto: string | null
}

export interface GitignoreReadResult {
  content: string
  path: string
}

export interface PullOptions {
  rebase?: boolean
  /** Pull a specific branch instead of the current one. */
  branch?: string
  /** Remote to pull from (default: 'origin'). */
  remote?: string
}

export interface PushOptions {
  setUpstream?: boolean
  force?: boolean
  /** Push a specific branch instead of the current one. */
  branch?: string
  /** Remote to push to (default: 'origin'). */
  remote?: string
}

export interface BranchCreateOptions {
  checkout?: boolean
  startPoint?: string
}

export interface DiffOptions {
  path: string
  staged: boolean
}

export interface GraphCommit {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  email: string
  date: string
  relativeDate: string
  subject: string
}

export interface Ref {
  name: string
  fullName: string
  hash: string
  upstream?: string
  current?: boolean
}

export interface RefSet {
  local: Ref[]
  remote: Ref[]
  tags: Ref[]
}

export interface Stash {
  index: number
  hash: string
  branch: string
  message: string
  relativeDate: string
}

export interface StashFileEntry {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?'
}

export interface StashPushOptions {
  message?: string
  includeUntracked?: boolean
  /** Limit stash to specific file paths (git stash push -- path1 path2) */
  paths?: string[]
}

export type CommitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'

export interface CommitChangedFile {
  path: string
  origPath?: string
  status: CommitFileStatus
}

export interface CommitDetail {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  email: string
  date: string
  relativeDate: string
  subject: string
  body: string
  files: CommitChangedFile[]
}

// ── CI / Pull-Request info (sourced from the `gh` CLI) ────────────────────

export type CheckRollupState = 'none' | 'pending' | 'success' | 'failure'

export interface CheckSummary {
  name: string
  state: CheckRollupState
  url?: string
  description?: string
  /** "check" = GitHub Checks API; "status" = legacy commit status context. */
  kind: 'check' | 'status'
  /**
   * GitHub Actions run ID extracted from the check's details URL.
   * Only present for `kind === 'check'` entries backed by Actions runs.
   * Used to call `gh run rerun`.
   */
  runId?: string
}

export interface PullRequestInfo {
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  title: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  checks: CheckSummary[]
  /** Aggregated state across all checks (also `'none'` when no checks ran). */
  rollup: CheckRollupState
}

/** Lightweight reference to a PR associated with a commit. */
export interface CommitPullRequestRef {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
}

export interface CommitChecksInfo {
  sha: string
  checks: CheckSummary[]
  rollup: CheckRollupState
  /** Pull requests this commit appears in (head SHA, or via merge). */
  pulls: CommitPullRequestRef[]
}

// ── App settings (persisted via electron-store, key encrypted via safeStorage)

/**
 * Public settings shape exposed to the renderer.  The API key itself is never
 * returned in clear-text — only `cursorApiKeySet` (boolean) flags whether one
 * has been stored.  Updates use {@link SettingsUpdate} which can carry the
 * raw key value.
 */
export interface SettingsView {
  cursorApiKeySet: boolean
  commitMessageRules: string
  /** Whether to GPG-sign commits. Defaults to false so unsigned commits work out of the box. */
  gpgSign: boolean
}

export interface SettingsUpdate {
  /**
   * `string` to set/replace the key; `null` to clear it; `undefined` to leave
   * the existing key untouched.
   */
  cursorApiKey?: string | null
  commitMessageRules?: string
  gpgSign?: boolean
}

export interface GeneratedCommitMessage {
  subject: string
  body: string
}

export interface PrListItem {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  url: string
  author: string
  createdAt: string
  updatedAt: string
  rollup: CheckRollupState
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  labels: string[]
}
