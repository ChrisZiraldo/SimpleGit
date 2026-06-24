import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw,
  GitMerge,
  GitPullRequest,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  ChevronLeft
} from 'lucide-react'
import { useRepo } from '../store/useRepo'
import type { CheckRollupState, PrListItem } from '@shared/types'
import { parseDiff } from '../utils/diffHunks'
import type { DiffFile } from '../utils/diffHunks'

// Max concurrent CI fetches so we don't hammer the GitHub API.
const CI_CONCURRENCY = 3

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export function PullRequestsView(): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const refs = useRepo((s) => s.refs)
  const status = useRepo((s) => s.status)
  const pushToast = useRepo((s) => s.pushToast)
  const ciAvailable = useRepo((s) => s.ciAvailable)

  const [prs, setPrs] = useState<PrListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ciRollup, setCiRollup] = useState<Record<number, CheckRollupState>>({})
  const abortRef = useRef<AbortController | null>(null)

  // Detail pane state
  const [selectedPr, setSelectedPr] = useState<PrListItem | null>(null)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  // Review state
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>('COMMENT')
  const [reviewBody, setReviewBody] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  // Create PR modal state
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [createBase, setCreateBase] = useState(status?.branch.upstream?.replace(/^[^/]+\//, '') ?? 'main')
  const [createDraft, setCreateDraft] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const currentBranch = status?.branch.current ?? ''

  const fetchPrs = useCallback(async (): Promise<void> => {
    if (!activeRepo) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setCiRollup({})
    try {
      const res = await window.git.pr.list(activeRepo.path)
      if (ctrl.signal.aborted) return
      if (!res.ok) { setError(res.stderr); return }
      setPrs(res.data)
      void loadCiLazy(activeRepo.path, res.data, ctrl.signal, setCiRollup)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [activeRepo])

  useEffect(() => {
    void fetchPrs()
    return () => { abortRef.current?.abort() }
  }, [fetchPrs])

  const openPrDetail = async (pr: PrListItem): Promise<void> => {
    if (!activeRepo) return
    setSelectedPr(pr)
    setDiffContent(null)
    setDiffLoading(true)
    const res = await window.git.prExtended.diff(activeRepo.path, pr.number)
    setDiffLoading(false)
    if (res.ok) setDiffContent(res.data)
    else setDiffContent(null)
  }

  const submitReview = async (): Promise<void> => {
    if (!activeRepo || !selectedPr) return
    setReviewSubmitting(true)
    const res = await window.git.prExtended.review(activeRepo.path, selectedPr.number, {
      event: reviewEvent,
      body: reviewBody.trim() || undefined
    })
    setReviewSubmitting(false)
    if (res.ok) {
      pushToast('success', `Review submitted: ${reviewEvent.replace('_', ' ').toLowerCase()}`)
      setReviewBody('')
    } else {
      pushToast('error', `Review failed: ${res.stderr}`)
    }
  }

  const submitCreatePr = async (): Promise<void> => {
    if (!activeRepo || !createTitle.trim()) return
    setCreateSubmitting(true)
    const res = await window.git.prExtended.create(activeRepo.path, {
      base: createBase,
      head: currentBranch,
      title: createTitle.trim(),
      body: createBody.trim() || undefined,
      draft: createDraft
    })
    setCreateSubmitting(false)
    if (res.ok) {
      pushToast('success', `PR #${res.data.number} created`)
      setCreateOpen(false)
      setCreateTitle('')
      setCreateBody('')
      void fetchPrs()
      void window.git.shell.openExternal(res.data.url)
    } else {
      pushToast('error', `Create PR failed: ${res.stderr}`)
    }
  }

  // Has no open PR for this branch?
  const noOpenPr = !prs.some((p) => p.headRefName === currentBranch)

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-line shrink-0 bg-bg-subtle">
        <div className="flex items-center gap-2">
          {selectedPr && (
            <button
              onClick={() => setSelectedPr(null)}
              className="p-1 rounded hover:bg-line text-muted hover:text-text transition-colors"
              title="Back to list"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <span className="text-sm font-medium">
            {selectedPr
              ? `PR #${selectedPr.number}: ${selectedPr.title}`
              : loading
                ? 'Loading…'
                : `${prs.length} open pull request${prs.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!selectedPr && currentBranch && noOpenPr && ciAvailable && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 transition-colors"
              title={`Create PR for ${currentBranch}`}
            >
              <Plus size={12} /> Create PR
            </button>
          )}
          {selectedPr && (
            <button
              onClick={() => void window.git.shell.openExternal(selectedPr.url)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted hover:text-text hover:bg-line transition-colors"
              title="Open on GitHub"
            >
              <ExternalLink size={12} /> Open on GitHub
            </button>
          )}
          <button
            onClick={() => void fetchPrs()}
            disabled={loading}
            title="Refresh"
            className="p-1.5 rounded hover:bg-line text-muted hover:text-text disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selectedPr ? (
          <PrDetailPane
            pr={selectedPr}
            diff={diffContent}
            diffLoading={diffLoading}
            reviewEvent={reviewEvent}
            setReviewEvent={setReviewEvent}
            reviewBody={reviewBody}
            setReviewBody={setReviewBody}
            reviewSubmitting={reviewSubmitting}
            onSubmitReview={submitReview}
            ciAvailable={!!ciAvailable}
          />
        ) : error ? (
          <GhUnavailable message={error} />
        ) : loading && prs.length === 0 ? (
          <LoadingSkeleton />
        ) : prs.length === 0 ? (
          <EmptyState />
        ) : (
          <ul>
            {prs.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                ciRollup={ciRollup[pr.number] ?? 'none'}
                ciLoading={!(pr.number in ciRollup) && !error}
                onClick={() => void openPrDetail(pr)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Create PR modal */}
      {createOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            style={{ background: '#0b0e14', border: '1px solid #2a2f3b', borderRadius: 12, padding: '20px 24px', width: 520, display: 'flex', flexDirection: 'column', gap: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#c9d1d9' }}>Create Pull Request</span>
              <button onClick={() => setCreateOpen(false)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>
              <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{currentBranch}</span> → base branch
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#8b949e', width: 40 }}>Base</label>
              <select
                value={createBase}
                onChange={(e) => setCreateBase(e.target.value)}
                style={{ flex: 1, padding: '4px 8px', background: '#161b22', border: '1px solid #2a2f3b', borderRadius: 6, color: '#c9d1d9', fontSize: 12 }}
              >
                {refs.local.map((r) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
            <input
              autoFocus
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Title (required)"
              style={{ padding: '6px 10px', background: '#161b22', border: '1px solid #2a2f3b', borderRadius: 6, color: '#c9d1d9', fontSize: 13, outline: 'none' }}
            />
            <textarea
              value={createBody}
              onChange={(e) => setCreateBody(e.target.value)}
              placeholder="Description (optional)"
              rows={5}
              style={{ padding: '6px 10px', background: '#161b22', border: '1px solid #2a2f3b', borderRadius: 6, color: '#c9d1d9', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b949e', cursor: 'pointer' }}>
              <input type="checkbox" checked={createDraft} onChange={(e) => setCreateDraft(e.target.checked)} />
              Create as draft
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCreateOpen(false)} style={{ padding: '5px 14px', background: '#21262d', border: '1px solid #2a2f3b', borderRadius: 6, color: '#8b949e', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button
                disabled={!createTitle.trim() || createSubmitting}
                onClick={() => void submitCreatePr()}
                style={{ padding: '5px 14px', background: '#238636', border: '1px solid #2ea043', borderRadius: 6, color: '#fff', fontSize: 12, cursor: 'pointer', opacity: createTitle.trim() && !createSubmitting ? 1 : 0.5 }}
              >
                {createSubmitting ? 'Creating…' : 'Create PR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PR detail pane ────────────────────────────────────────────────────────

interface PrDetailPaneProps {
  pr: PrListItem
  diff: string | null
  diffLoading: boolean
  reviewEvent: ReviewEvent
  setReviewEvent: (e: ReviewEvent) => void
  reviewBody: string
  setReviewBody: (b: string) => void
  reviewSubmitting: boolean
  onSubmitReview: () => void
  ciAvailable: boolean
}

function PrDetailPane({
  pr, diff, diffLoading,
  reviewEvent, setReviewEvent, reviewBody, setReviewBody,
  reviewSubmitting, onSubmitReview, ciAvailable
}: PrDetailPaneProps): JSX.Element {
  const files: DiffFile[] = diff ? parseDiff(diff) : []

  return (
    <div className="flex flex-col h-full">
      {/* PR meta */}
      <div className="px-4 py-3 border-b border-line bg-bg-subtle shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pr.isDraft ? 'bg-line text-muted' : 'bg-success/15 text-success'}`}>
            {pr.isDraft ? 'Draft' : 'Open'}
          </span>
          {pr.mergeable === 'CONFLICTING' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-danger/15 text-danger font-medium">Conflicts</span>
          )}
          <span className="text-xs text-muted">{pr.author}</span>
          <span className="text-xs text-muted font-mono">{pr.baseRefName} ← {pr.headRefName}</span>
        </div>
        {pr.labels.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {pr.labels.map((l) => (
              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">{l}</span>
            ))}
          </div>
        )}
      </div>

      {/* Diff */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {diffLoading ? (
          <div className="flex items-center justify-center h-32 text-muted text-sm">Loading diff…</div>
        ) : !diff ? (
          <div className="flex items-center justify-center h-32 text-muted text-sm">
            {ciAvailable ? 'No diff available' : 'gh CLI required for PR diff'}
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted text-sm">No changes</div>
        ) : (
          <div className="font-mono text-xs">
            {files.map((file) => (
              <PrDiffFile key={file.path} file={file} />
            ))}
          </div>
        )}
      </div>

      {/* Review pane */}
      {ciAvailable && (
        <div className="border-t border-line px-4 py-3 shrink-0 bg-bg-subtle">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Review</span>
            <div className="flex gap-1">
              {(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as ReviewEvent[]).map((ev) => (
                <button
                  key={ev}
                  onClick={() => setReviewEvent(ev)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    reviewEvent === ev
                      ? ev === 'APPROVE' ? 'bg-success/15 border-success/40 text-success'
                        : ev === 'REQUEST_CHANGES' ? 'bg-danger/15 border-danger/40 text-danger'
                        : 'bg-accent/15 border-accent/40 text-accent'
                      : 'bg-bg-panel border-line text-muted hover:text-text'
                  }`}
                >
                  {ev === 'REQUEST_CHANGES' ? 'Request changes' : ev.charAt(0) + ev.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder={reviewEvent === 'APPROVE' ? 'Optional comment…' : 'Review comment (required for Request changes)…'}
            rows={3}
            className="w-full px-2 py-1.5 bg-bg-panel border border-line rounded-md text-xs font-mono focus:outline-none focus:border-accent resize-none"
          />
          <div className="flex justify-end mt-2">
            <button
              disabled={reviewSubmitting || (reviewEvent === 'REQUEST_CHANGES' && !reviewBody.trim())}
              onClick={onSubmitReview}
              className="px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover disabled:bg-line disabled:text-muted text-white text-xs font-medium"
            >
              {reviewSubmitting ? 'Submitting…' : 'Submit review'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PrDiffFile({ file }: { file: DiffFile }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions++
      else if (line.kind === 'del') deletions++
    }
  }
  return (
    <div className="border-b border-line">
      <button
        className="w-full flex items-center gap-2 px-4 py-2 bg-bg-subtle hover:bg-line text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-muted">{collapsed ? '▶' : '▼'}</span>
        <span className="flex-1 text-xs text-text truncate">{file.path}</span>
        <span className={`text-xs font-medium ${additions > 0 ? 'text-success' : 'text-muted'}`}>+{additions}</span>
        <span className={`text-xs font-medium ml-1 ${deletions > 0 ? 'text-danger' : 'text-muted'}`}>-{deletions}</span>
      </button>
      {!collapsed && (
        <div>
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="px-4 py-0.5 bg-accent/5 text-accent/70 text-[11px] font-mono">{hunk.header}</div>
              {hunk.lines.map((line, li) => {
                const bg = line.kind === 'add' ? 'bg-success/8' : line.kind === 'del' ? 'bg-danger/8' : ''
                const color = line.kind === 'add' ? 'text-success' : line.kind === 'del' ? 'text-danger' : 'text-muted'
                const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
                return (
                  <div key={li} className={`flex px-4 py-0 leading-5 ${bg}`}>
                    <span className={`w-8 shrink-0 text-right text-[10px] pr-2 select-none ${color} opacity-50`}>
                      {line.oldNum ?? ''}
                    </span>
                    <span className={`w-8 shrink-0 text-right text-[10px] pr-2 select-none ${color} opacity-50`}>
                      {line.newNum ?? ''}
                    </span>
                    <span className={`mr-1 shrink-0 select-none ${color}`}>{prefix}</span>
                    <span className={`flex-1 min-w-0 whitespace-pre-wrap break-all ${line.kind !== 'context' ? color : 'text-text'}`}>
                      {line.content}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Lazy CI loader ────────────────────────────────────────────────────────

async function loadCiLazy(
  cwd: string,
  prs: PrListItem[],
  signal: AbortSignal,
  setRollup: React.Dispatch<React.SetStateAction<Record<number, CheckRollupState>>>
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: CI_CONCURRENCY }, async () => {
    while (i < prs.length) {
      if (signal.aborted) return
      const pr = prs[i++]
      try {
        const res = await window.git.ci.prStatus(cwd, pr.headRefName)
        if (signal.aborted) return
        setRollup((prev) => ({
          ...prev,
          [pr.number]: res.ok ? (res.data?.rollup ?? 'none') : 'none'
        }))
      } catch {
        if (!signal.aborted) setRollup((prev) => ({ ...prev, [pr.number]: 'none' }))
      }
    }
  })
  await Promise.all(workers)
}

// ── PR row ────────────────────────────────────────────────────────────────

interface PrRowProps {
  pr: PrListItem
  ciRollup: CheckRollupState
  ciLoading: boolean
  onClick: () => void
}

function PrRow({ pr, ciRollup, ciLoading, onClick }: PrRowProps): JSX.Element {
  const relative = relativeTime(pr.updatedAt)
  return (
    <li
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 border-b border-line hover:bg-bg-subtle cursor-pointer group"
    >
      <CiDot state={ciRollup} loading={ciLoading} />
      <span className="text-xs font-mono text-muted shrink-0 w-10 text-right">#{pr.number}</span>
      <div className="flex items-center gap-1 shrink-0">
        {pr.isDraft && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-line text-muted">Draft</span>
        )}
        {pr.mergeable === 'CONFLICTING' && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/15 text-danger" title="Has merge conflicts">Conflict</span>
        )}
        {pr.labels.slice(0, 3).map((l) => (
          <span key={l} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">{l}</span>
        ))}
      </div>
      <span className="flex-1 min-w-0 text-sm font-medium truncate group-hover:text-accent transition-colors">{pr.title}</span>
      <div className="flex items-center gap-2 text-xs text-muted shrink-0">
        <span>{pr.author}</span>
        <span className="text-line">·</span>
        <span className="font-mono truncate max-w-[200px]">
          {pr.baseRefName}<span className="mx-1 text-line">←</span>{pr.headRefName}
        </span>
        <span className="text-line">·</span>
        <span>{relative}</span>
      </div>
    </li>
  )
}

// ── CI dot ────────────────────────────────────────────────────────────────

function CiDot({ state, loading }: { state: CheckRollupState; loading: boolean }): JSX.Element {
  if (loading) return <span className="shrink-0 w-3.5 h-3.5 rounded-full border border-line animate-pulse bg-line" />
  if (state === 'success') return <span title="Checks passed" className="shrink-0"><CheckCircle2 size={14} className="text-success" /></span>
  if (state === 'failure') return <span title="Checks failed" className="shrink-0"><AlertCircle size={14} className="text-danger" /></span>
  if (state === 'pending') return <span title="Checks pending" className="shrink-0"><Clock size={14} className="text-warn" /></span>
  return <span title="No checks" className="shrink-0"><GitPullRequest size={14} className="text-muted" /></span>
}

// ── Empty / error states ──────────────────────────────────────────────────

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
        <GitMerge size={24} className="text-success" />
      </div>
      <div>
        <div className="font-medium text-sm">All clear</div>
        <div className="text-xs text-muted mt-1">No open pull requests for this repository.</div>
      </div>
    </div>
  )
}

function GhUnavailable({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center">
        <AlertCircle size={24} className="text-danger" />
      </div>
      <div>
        <div className="font-medium text-sm">Could not load pull requests</div>
        <div className="text-xs text-muted mt-1 max-w-xs font-mono break-words">{message}</div>
        <div className="text-xs text-muted mt-2">
          Make sure <code className="bg-bg-subtle px-1 rounded">gh</code> is installed and authenticated.
        </div>
      </div>
    </div>
  )
}

function LoadingSkeleton(): JSX.Element {
  return (
    <ul>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3 border-b border-line animate-pulse">
          <div className="w-3.5 h-3.5 rounded-full bg-line shrink-0" />
          <div className="w-8 h-3 rounded bg-line shrink-0" />
          <div className="flex-1 h-3 rounded bg-line" style={{ maxWidth: `${40 + (i % 4) * 12}%` }} />
          <div className="w-24 h-3 rounded bg-line shrink-0" />
        </li>
      ))}
    </ul>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
