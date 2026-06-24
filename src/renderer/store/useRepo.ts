import { create } from 'zustand'
import type {
  Branch,
  Commit,
  CommitChecksInfo,
  CommitDetail,
  GraphCommit,
  PullRequestInfo,
  RebasePlanEntry,
  RecentRepo,
  RefSet,
  Stash,
  StatusResult
} from '@shared/types'

export interface StashViewEntry {
  stashIndex: number
  filePath: string
}

export interface ToastEntry {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
  /** Optional undo action shown as a button in the toast. */
  onUndo?: () => void
}

export interface UndoEntry {
  label: string
  beforeSha: string
}

const EMPTY_REFS: RefSet = { local: [], remote: [], tags: [] }

export type MetroViewTab = 'history' | 'prs' | 'insights' | 'authors'

/** What the user wants to keep when they pick a CI status filter.
 * `all` is the default no-op. The other values map onto `CheckRollupState`
 * with `none` covering "no PR / no checks at all". */
export type CiFilter = 'all' | 'passing' | 'failing' | 'pending' | 'none'

/** Calendar window (relative to "now") for filtering branches by tip date. */
export type DateRangeFilter = 'all' | '7d' | '30d' | '90d'

export interface MetroFilters {
  showMerged: boolean
  showStale: boolean
  ciStatus: CiFilter
  /** Lowercased author email; null means "all authors". */
  author: string | null
  dateRange: DateRangeFilter
}

interface RepoState {
  activeRepo: RecentRepo | null
  recents: RecentRepo[]
  status: StatusResult | null
  branches: Branch[]
  refs: RefSet
  stashes: Stash[]
  graph: GraphCommit[]
  commits: Commit[]
  selectedFile: { path: string; staged: boolean } | null
  stashView: StashViewEntry | null
  selectedCommit: string | null
  commitDetail: CommitDetail | null
  selectedCommitFile: string | null
  diff: string
  diffLoading: boolean
  busy: boolean
  drawerHeight: number
  refreshVersion: number
  toasts: ToastEntry[]
  // Metro UI state
  metroViewTab: MetroViewTab
  highlightedBranchId: string | null
  metroFilters: MetroFilters
  // CI / PR status — keyed by branch name. `undefined` = not fetched yet,
  // `null` = fetched and there is no PR for this branch.
  ciByBranch: Record<string, PullRequestInfo | null>
  ciLoading: Record<string, boolean>
  /** Per-commit CI data keyed by full SHA. */
  ciByCommit: Record<string, CommitChecksInfo | null>
  ciCommitLoading: Record<string, boolean>
  ciAvailable: boolean | null
  // Undo stack — captures HEAD SHA before each destructive operation
  undoStack: UndoEntry[]
  // Commit search query
  commitQuery: string
  // Interactive rebase
  rebasePlan: RebasePlanEntry[]
  rebaseInProgress: boolean
  setActiveRepo: (repo: RecentRepo | null) => void
  setRecents: (recents: RecentRepo[]) => void
  setStatus: (status: StatusResult | null) => void
  setBranches: (branches: Branch[]) => void
  setRefs: (refs: RefSet) => void
  setStashes: (stashes: Stash[]) => void
  setGraph: (graph: GraphCommit[]) => void
  setCommits: (commits: Commit[]) => void
  setSelectedFile: (sel: { path: string; staged: boolean } | null) => void
  setStashView: (entry: StashViewEntry | null) => void
  setSelectedCommit: (hash: string | null) => void
  setCommitDetail: (detail: CommitDetail | null) => void
  setSelectedCommitFile: (path: string | null) => void
  setDiff: (diff: string) => void
  setDiffLoading: (loading: boolean) => void
  setBusy: (busy: boolean) => void
  setDrawerHeight: (h: number) => void
  setMetroViewTab: (tab: MetroViewTab) => void
  setHighlightedBranchId: (id: string | null) => void
  setMetroFilters: (patch: Partial<MetroFilters>) => void
  setCiForBranch: (branch: string, info: PullRequestInfo | null) => void
  setCiLoading: (branch: string, loading: boolean) => void
  setCiForCommit: (sha: string, info: CommitChecksInfo | null) => void
  setCiCommitLoading: (sha: string, loading: boolean) => void
  setCiAvailable: (available: boolean) => void
  clearCi: () => void
  refreshSignal: () => void
  pushToast: (kind: ToastEntry['kind'], text: string, onUndo?: () => void) => void
  dismissToast: (id: number) => void
  pushUndoEntry: (entry: UndoEntry) => void
  popUndoEntry: () => UndoEntry | undefined
  setCommitQuery: (query: string) => void
  setRebasePlan: (plan: RebasePlanEntry[]) => void
  setRebaseInProgress: (inProgress: boolean) => void
}

let toastSeq = 0

const DEFAULT_DRAWER_HEIGHT = 320

/**
 * Reads `gitmetro.<key>` first, falling back to legacy `gitexpress.<key>` and
 * `simplegit.<key>` keys for in-place migration from older brandings.
 */
function readPref(key: string): string | null {
  try {
    return (
      localStorage.getItem(`gitmetro.${key}`) ??
      localStorage.getItem(`gitexpress.${key}`) ??
      localStorage.getItem(`simplegit.${key}`)
    )
  } catch {
    return null
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`gitmetro.${key}`, value)
  } catch {
    /* ignore */
  }
}

// Legacy `viewMode` preference is no longer used — the metro view is the
// only view. Best-effort cleanup of the stored value so reinstalls start
// fresh, but don't fail if storage is unavailable.
try {
  localStorage.removeItem('gitmetro.viewMode')
  localStorage.removeItem('gitexpress.viewMode')
  localStorage.removeItem('simplegit.viewMode')
} catch {
  /* ignore */
}

function loadDrawerHeight(): number {
  const raw = readPref('drawerHeight')
  if (!raw) return DEFAULT_DRAWER_HEIGHT
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 120) return DEFAULT_DRAWER_HEIGHT
  return n
}

export const useRepo = create<RepoState>((set) => ({
  activeRepo: null,
  recents: [],
  status: null,
  branches: [],
  refs: EMPTY_REFS,
  stashes: [],
  graph: [],
  commits: [],
  selectedFile: null,
  stashView: null,
  selectedCommit: null,
  commitDetail: null,
  selectedCommitFile: null,
  diff: '',
  diffLoading: false,
  busy: false,
  drawerHeight: loadDrawerHeight(),
  refreshVersion: 0,
  toasts: [],
  metroViewTab: 'history',
  highlightedBranchId: null,
  metroFilters: {
    showMerged: true,
    showStale: false,
    ciStatus: 'all',
    author: null,
    dateRange: 'all'
  },
  ciByBranch: {},
  ciLoading: {},
  ciByCommit: {},
  ciCommitLoading: {},
  ciAvailable: null,
  undoStack: [],
  commitQuery: '',
  rebasePlan: [],
  rebaseInProgress: false,
  setActiveRepo: (repo) =>
    set({
      activeRepo: repo,
      busy: false,
      status: null,
      branches: [],
      refs: EMPTY_REFS,
      stashes: [],
      graph: [],
      commits: [],
      selectedFile: null,
      stashView: null,
      selectedCommit: null,
      commitDetail: null,
      selectedCommitFile: null,
      diff: '',
      ciByBranch: {},
      ciLoading: {},
      ciByCommit: {},
      ciCommitLoading: {},
      undoStack: [],
      commitQuery: '',
      rebasePlan: [],
      rebaseInProgress: false
    }),
  setRecents: (recents) => set({ recents }),
  setStatus: (status) => set({ status }),
  setBranches: (branches) => set({ branches }),
  setRefs: (refs) => set({ refs }),
  setStashes: (stashes) => set({ stashes }),
  setGraph: (graph) => set({ graph }),
  setCommits: (commits) => set({ commits }),
  setSelectedFile: (selectedFile) => set({ selectedFile, stashView: null }),
  setStashView: (stashView) =>
    set({ stashView, selectedCommit: null, selectedFile: null, diff: '' }),
  setSelectedCommit: (hash) =>
    set({
      selectedCommit: hash,
      commitDetail: null,
      selectedCommitFile: null,
      selectedFile: null,
      stashView: null,
      diff: ''
    }),
  setCommitDetail: (detail) => set({ commitDetail: detail }),
  setSelectedCommitFile: (path) => set({ selectedCommitFile: path }),
  setDiff: (diff) => set({ diff }),
  setDiffLoading: (diffLoading) => set({ diffLoading }),
  setBusy: (busy) => set({ busy }),
  setDrawerHeight: (h) => {
    writePref('drawerHeight', String(h))
    set({ drawerHeight: h })
  },
  setMetroViewTab: (tab) => set({ metroViewTab: tab }),
  setHighlightedBranchId: (id) => set({ highlightedBranchId: id }),
  setMetroFilters: (patch) =>
    set((state) => ({ metroFilters: { ...state.metroFilters, ...patch } })),
  setCiForBranch: (branch, info) =>
    set((state) => ({
      ciByBranch: { ...state.ciByBranch, [branch]: info }
    })),
  setCiLoading: (branch, loading) =>
    set((state) => {
      const next = { ...state.ciLoading }
      if (loading) next[branch] = true
      else delete next[branch]
      return { ciLoading: next }
    }),
  setCiForCommit: (sha, info) =>
    set((state) => ({
      ciByCommit: { ...state.ciByCommit, [sha]: info }
    })),
  setCiCommitLoading: (sha, loading) =>
    set((state) => {
      const next = { ...state.ciCommitLoading }
      if (loading) next[sha] = true
      else delete next[sha]
      return { ciCommitLoading: next }
    }),
  setCiAvailable: (available) => set({ ciAvailable: available }),
  clearCi: () =>
    set({
      ciByBranch: {},
      ciLoading: {},
      ciByCommit: {},
      ciCommitLoading: {}
    }),
  refreshSignal: () =>
    set((state) => ({ refreshVersion: state.refreshVersion + 1 })),
  pushToast: (kind, text, onUndo) =>
    set((state) => {
      const id = ++toastSeq
      const entry: ToastEntry = { id, kind, text, onUndo }
      setTimeout(
        () => {
          useRepo.getState().dismissToast(id)
        },
        kind === 'error' ? 6000 : (onUndo ? 8000 : 3000)
      )
      return { toasts: [...state.toasts, entry] }
    }),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  pushUndoEntry: (entry) =>
    set((state) => ({ undoStack: [...state.undoStack.slice(-19), entry] })),
  popUndoEntry: () => {
    let popped: UndoEntry | undefined
    useRepo.setState((state) => {
      const stack = [...state.undoStack]
      popped = stack.pop()
      return { undoStack: stack }
    })
    return popped
  },
  setCommitQuery: (query) => set({ commitQuery: query }),
  setRebasePlan: (plan) => set({ rebasePlan: plan }),
  setRebaseInProgress: (inProgress) => set({ rebaseInProgress: inProgress })
}))
