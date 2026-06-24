import type {
  CheckRollupState,
  CheckSummary,
  CommitChecksInfo,
  CommitPullRequestRef,
  PrCreateOptions,
  PrListItem,
  PrReviewOptions,
  PullRequestInfo,
  Result
} from '@shared/types'
import { runGh } from './runner'
import { runGit } from '../git/runner'

// gh pr view --json field shapes. Two possible entries in statusCheckRollup:
//   - CheckRun (GitHub Checks API)
//   - StatusContext (legacy commit statuses)
interface GhPrJson {
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  title: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  statusCheckRollup: RollupEntry[]
}

type RollupEntry =
  | {
      __typename: 'CheckRun'
      name: string
      status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'WAITING' | 'PENDING' | 'REQUESTED'
      conclusion:
        | 'SUCCESS'
        | 'FAILURE'
        | 'NEUTRAL'
        | 'CANCELLED'
        | 'SKIPPED'
        | 'TIMED_OUT'
        | 'ACTION_REQUIRED'
        | 'STALE'
        | ''
        | null
      detailsUrl?: string
      workflowName?: string
      startedAt?: string
      completedAt?: string
    }
  | {
      __typename: 'StatusContext'
      context: string
      state: 'ERROR' | 'EXPECTED' | 'FAILURE' | 'PENDING' | 'SUCCESS'
      targetUrl?: string
      description?: string
    }

const PR_FIELDS = [
  'number',
  'state',
  'url',
  'title',
  'headRefName',
  'baseRefName',
  'isDraft',
  'mergeable',
  'statusCheckRollup'
].join(',')

/**
 * Extract a GitHub Actions run ID from a check details URL.
 * URL shape: https://github.com/<owner>/<repo>/actions/runs/<runId>/job/<jobId>
 */
function extractRunId(url: string | undefined): string | undefined {
  if (!url) return undefined
  const m = /\/actions\/runs\/(\d+)/.exec(url)
  return m?.[1]
}

/** Normalize a rollup entry into our shared CheckSummary type. */
function normalizeEntry(entry: RollupEntry): CheckSummary {
  if (entry.__typename === 'CheckRun') {
    const isComplete = entry.status === 'COMPLETED'
    let state: CheckRollupState = 'pending'
    if (isComplete) {
      switch (entry.conclusion) {
        case 'SUCCESS':
        case 'NEUTRAL':
        case 'SKIPPED':
          state = 'success'
          break
        case 'FAILURE':
        case 'CANCELLED':
        case 'TIMED_OUT':
        case 'ACTION_REQUIRED':
        case 'STALE':
          state = 'failure'
          break
        default:
          state = 'pending'
      }
    }
    return {
      name: entry.workflowName ? `${entry.workflowName} / ${entry.name}` : entry.name,
      state,
      url: entry.detailsUrl,
      kind: 'check',
      runId: extractRunId(entry.detailsUrl)
    }
  }
  // StatusContext
  let state: CheckRollupState = 'pending'
  switch (entry.state) {
    case 'SUCCESS':
      state = 'success'
      break
    case 'FAILURE':
    case 'ERROR':
      state = 'failure'
      break
    default:
      state = 'pending'
  }
  return {
    name: entry.context,
    state,
    url: entry.targetUrl,
    description: entry.description,
    kind: 'status',
    runId: extractRunId(entry.targetUrl)
  }
}

/**
 * Rolls up an array of check summaries into a single state.
 *   any pending  → 'pending'
 *   any failure  → 'failure'
 *   all success  → 'success'
 *   no entries   → 'none'
 */
function rollup(checks: CheckSummary[]): CheckRollupState {
  if (checks.length === 0) return 'none'
  let hasPending = false
  for (const c of checks) {
    if (c.state === 'failure') return 'failure'
    if (c.state === 'pending') hasPending = true
  }
  return hasPending ? 'pending' : 'success'
}

/**
 * Fetches PR information + CI rollup for the named branch. Returns
 *   data: null  → no open PR for this branch (not an error)
 *   ok: false   → gh not installed / not authenticated / network error / etc.
 */
export async function getPullRequestForBranch(
  cwd: string,
  branch: string
): Promise<Result<PullRequestInfo | null>> {
  if (!branch) return { ok: false, code: 1, stderr: 'Branch name required' }

  const res = await runGh(
    ['pr', 'view', branch, '--json', PR_FIELDS],
    { cwd, allowExitCodes: [1] }
  )
  if (!res.ok) return res
  const trimmed = res.data.trim()
  // gh prints to stdout on success, stderr on "no PR" (which we swallow via
  // allowExitCodes). Both paths land here — distinguish by content.
  if (!trimmed || !trimmed.startsWith('{')) return { ok: true, data: null }

  try {
    const json = JSON.parse(trimmed) as GhPrJson
    const checks = (json.statusCheckRollup ?? []).map(normalizeEntry)
    const pr: PullRequestInfo = {
      number: json.number,
      state: json.state,
      url: json.url,
      title: json.title,
      headRefName: json.headRefName,
      baseRefName: json.baseRefName,
      isDraft: json.isDraft,
      mergeable: json.mergeable,
      checks,
      rollup: rollup(checks)
    }
    return { ok: true, data: pr }
  } catch (err) {
    return {
      ok: false,
      code: 1,
      stderr: `Failed to parse gh JSON: ${(err as Error).message}`
    }
  }
}

// ── Per-commit checks ────────────────────────────────────────────────────

interface ApiCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending' | 'requested'
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | 'stale'
    | null
  html_url?: string
  details_url?: string
  app?: { name?: string; slug?: string }
}

interface ApiCommitStatus {
  state: 'pending' | 'success' | 'failure' | 'error'
  statuses: Array<{
    context: string
    state: 'pending' | 'success' | 'failure' | 'error'
    target_url?: string
    description?: string
  }>
}

interface ApiAssociatedPull {
  number: number
  html_url: string
  title: string
  state: 'open' | 'closed'
  merged_at: string | null
}

function checkRunToSummary(c: ApiCheckRun): CheckSummary {
  let state: CheckRollupState = 'pending'
  if (c.status === 'completed') {
    switch (c.conclusion) {
      case 'success':
      case 'neutral':
      case 'skipped':
        state = 'success'
        break
      case 'failure':
      case 'cancelled':
      case 'timed_out':
      case 'action_required':
      case 'stale':
        state = 'failure'
        break
      default:
        state = 'pending'
    }
  }
  const appName = c.app?.name || c.app?.slug
  return {
    name: appName ? `${appName} / ${c.name}` : c.name,
    state,
    url: c.html_url || c.details_url,
    kind: 'check'
  }
}

function statusContextToSummary(s: ApiCommitStatus['statuses'][number]): CheckSummary {
  let state: CheckRollupState = 'pending'
  switch (s.state) {
    case 'success':
      state = 'success'
      break
    case 'failure':
    case 'error':
      state = 'failure'
      break
    default:
      state = 'pending'
  }
  return {
    name: s.context,
    state,
    url: s.target_url,
    description: s.description,
    kind: 'status'
  }
}

/**
 * Fetches CI check-runs + legacy commit statuses + associated PRs for the
 * given commit SHA. Uses gh's `{owner}/{repo}` placeholder substitution so
 * we don't have to parse remotes ourselves.
 *
 * Returns:
 *   data: null  → not a GitHub repo / no access / SHA not known by remote
 *   ok: true    → checks + pulls (either may be empty)
 *   ok: false   → unrecoverable error (gh missing, auth, etc.)
 */
export async function getChecksForCommit(
  cwd: string,
  sha: string
): Promise<Result<CommitChecksInfo | null>> {
  if (!sha) return { ok: false, code: 1, stderr: 'Commit SHA required' }

  const [checksRes, statusRes, pullsRes] = await Promise.all([
    runGh(
      ['api', `/repos/{owner}/{repo}/commits/${sha}/check-runs`, '--jq', '.check_runs'],
      { cwd, allowExitCodes: [1, 4] }
    ),
    runGh(
      ['api', `/repos/{owner}/{repo}/commits/${sha}/status`],
      { cwd, allowExitCodes: [1, 4] }
    ),
    runGh(
      [
        'api',
        `/repos/{owner}/{repo}/commits/${sha}/pulls`,
        '-H',
        'Accept: application/vnd.github.groot-preview+json',
        '--jq',
        '[.[] | {number, html_url, title, state, merged_at}]'
      ],
      { cwd, allowExitCodes: [1, 4] }
    )
  ])

  // If gh can't resolve {owner}/{repo} (not a GitHub remote), every call
  // will fail similarly. Treat that as "no data" rather than an error.
  if (!checksRes.ok && !statusRes.ok && !pullsRes.ok) {
    return { ok: true, data: null }
  }

  const checks: CheckSummary[] = []
  if (checksRes.ok && checksRes.data.trim()) {
    try {
      const arr = JSON.parse(checksRes.data) as ApiCheckRun[]
      for (const c of arr) checks.push(checkRunToSummary(c))
    } catch {
      /* ignore parse errors — leave list empty */
    }
  }
  if (statusRes.ok && statusRes.data.trim()) {
    try {
      const st = JSON.parse(statusRes.data) as ApiCommitStatus
      for (const s of st.statuses ?? []) checks.push(statusContextToSummary(s))
    } catch {
      /* ignore */
    }
  }

  const pulls: CommitPullRequestRef[] = []
  if (pullsRes.ok && pullsRes.data.trim()) {
    try {
      const arr = JSON.parse(pullsRes.data) as ApiAssociatedPull[]
      for (const p of arr) {
        const state: CommitPullRequestRef['state'] = p.merged_at
          ? 'MERGED'
          : p.state === 'open'
            ? 'OPEN'
            : 'CLOSED'
        pulls.push({
          number: p.number,
          url: p.html_url,
          title: p.title,
          state
        })
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    data: {
      sha,
      checks,
      rollup: rollup(checks),
      pulls
    }
  }
}

// ── PR list ───────────────────────────────────────────────────────────────

interface GhPrListItem {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  url: string
  author: { login: string }
  createdAt: string
  updatedAt: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  labels: { name: string }[]
}

// `statusCheckRollup` is intentionally excluded from the list query.  It
// requires a separate GraphQL sub-request for every PR and causes GitHub's
// API to return HTTP 504 on repos with more than a handful of open PRs.
// CI rollup is fetched lazily per-PR by the renderer after the list loads.
const LIST_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'headRefName',
  'baseRefName',
  'url',
  'author',
  'createdAt',
  'updatedAt',
  'mergeable',
  'labels'
].join(',')

/**
 * Returns all open PRs for the repo (limit 100).  Returns an empty array when
 * the repo has no open PRs.  Returns `ok: false` when `gh` is unavailable or
 * not authenticated.
 *
 * CI rollup is NOT included here to avoid GitHub GraphQL timeouts.  Use
 * {@link getPullRequestForBranch} per-PR to lazily fetch CI status.
 */
export async function listPullRequests(cwd: string): Promise<Result<PrListItem[]>> {
  const res = await runGh(
    ['pr', 'list', '--state', 'open', '--json', LIST_FIELDS, '--limit', '100'],
    { cwd }
  )
  if (!res.ok) return res

  try {
    const json = JSON.parse(res.data.trim()) as GhPrListItem[]
    const items: PrListItem[] = json.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      isDraft: p.isDraft,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      url: p.url,
      author: p.author?.login ?? '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      rollup: 'none' as const,
      mergeable: p.mergeable,
      labels: (p.labels ?? []).map((l) => l.name)
    }))
    return { ok: true, data: items }
  } catch (err) {
    return {
      ok: false,
      code: 1,
      stderr: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Trigger a re-run of a GitHub Actions workflow run.
 *   failedOnly = true  → `gh run rerun <id> --failed`   (rerun failed jobs only)
 *   failedOnly = false → `gh run rerun <id>`             (rerun all jobs)
 */
export async function rerunRun(
  cwd: string,
  runId: string,
  failedOnly: boolean
): Promise<Result<true>> {
  const args = ['run', 'rerun', runId]
  if (failedOnly) args.push('--failed')
  const res = await runGh(args, { cwd })
  if (!res.ok) return res
  return { ok: true, data: true }
}

// ── PR creation ───────────────────────────────────────────────────────────

export async function createPullRequest(
  cwd: string,
  opts: PrCreateOptions
): Promise<Result<{ url: string; number: number }>> {
  const args = ['pr', 'create', '--title', opts.title, '--base', opts.base, '--head', opts.head]
  if (opts.body) args.push('--body', opts.body)
  else args.push('--body', '')
  if (opts.draft) args.push('--draft')
  args.push('--json', 'url,number')
  const res = await runGh(args, { cwd })
  if (!res.ok) return res
  try {
    const data = JSON.parse(res.data.trim()) as { url: string; number: number }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, code: 1, stderr: `Failed to parse response: ${String(err)}` }
  }
}

// ── PR review ────────────────────────────────────────────────────────────

export async function reviewPullRequest(
  cwd: string,
  prNumber: number,
  opts: PrReviewOptions
): Promise<Result<true>> {
  const args = ['pr', 'review', String(prNumber)]
  if (opts.event === 'APPROVE') args.push('--approve')
  else if (opts.event === 'REQUEST_CHANGES') args.push('--request-changes')
  else args.push('--comment')
  if (opts.body) args.push('--body', opts.body)
  else if (opts.event !== 'APPROVE') args.push('--body', ' ')
  const res = await runGh(args, { cwd })
  if (!res.ok) return res
  return { ok: true, data: true }
}

// ── PR diff ───────────────────────────────────────────────────────────────

export async function getPrDiff(cwd: string, prNumber: number): Promise<Result<string>> {
  const res = await runGh(['pr', 'diff', String(prNumber)], { cwd })
  return res
}

/**
 * Rerun the most recent workflow run on the current branch.
 * Used as a fallback when individual check runIds are unavailable.
 */
export async function rerunLatest(
  cwd: string,
  failedOnly: boolean
): Promise<Result<true>> {
  // Resolve the current branch so we only rerun runs on this branch
  const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  const branch = branchRes.ok ? branchRes.data.trim() : ''

  const listArgs = ['run', 'list', '--limit', '1', '--json', 'databaseId']
  if (branch && branch !== 'HEAD') listArgs.push('--branch', branch)

  const listRes = await runGh(listArgs, { cwd })
  if (!listRes.ok) return listRes
  let runs: Array<{ databaseId: number }>
  try {
    runs = JSON.parse(listRes.data.trim()) as Array<{ databaseId: number }>
  } catch {
    return { ok: false, code: 1, stderr: 'Failed to parse run list' }
  }
  if (runs.length === 0) return { ok: false, code: 1, stderr: 'No recent runs found' }
  const runId = String(runs[0].databaseId)
  const args = ['run', 'rerun', runId]
  if (failedOnly) args.push('--failed')
  const res = await runGh(args, { cwd })
  if (!res.ok) return res
  return { ok: true, data: true }
}

