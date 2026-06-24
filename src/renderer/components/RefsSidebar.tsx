import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Flag,
  TramFront,
  CheckCircle2,
  XCircle,
  GitMerge,
  GitPullRequest,
  EyeOff,
  Cloud,
  Folder,
  Github,
  Monitor,
  Search,
  X,
  Archive
} from 'lucide-react'
import type { GraphCommit, Ref, Stash, StashFileEntry } from '@shared/types'
import { useRepo } from '../store/useRepo'
import { useMapCi } from '../hooks/useMapCi'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { branchColor } from './metro/colors'
import {
  buildCiByHash,
  computeMetroLayout,
  dateRangeCutoff
} from './metro/computeMetroLayout'
import type { CiFilter, DateRangeFilter } from '../store/useRepo'

const MIN_WIDTH = 220
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 280

// ── Fuzzy matching for the branch filter input ─────────────────────────────

/**
 * Returns the indices in `text` that match `query` characters in order.
 * Empty array means no match (or empty query).
 */
function fuzzyIndices(text: string, query: string): number[] {
  if (!query) return []
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const indices: number[] = []
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      indices.push(i)
      qi++
    }
  }
  return qi === q.length ? indices : []
}

function fuzzyMatches(text: string, query: string): boolean {
  return !query || fuzzyIndices(text, query).length > 0
}

/** Renders a name with the matching characters highlighted. */
function HighlightedName({
  name,
  query
}: {
  name: string
  query: string
}): JSX.Element {
  if (!query) return <>{name}</>
  const indices = new Set(fuzzyIndices(name, query))
  if (indices.size === 0) return <>{name}</>
  return (
    <>
      {name.split('').map((ch, i) =>
        indices.has(i) ? (
          <mark key={i} className="bg-transparent text-accent font-semibold">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  )
}

type SidebarSection =
  | 'repo'
  | 'currentBranch'
  | 'localBranches'
  | 'remoteBranches'
  | 'filters'
  | 'legend'
  | 'stashes'
  | 'tags'

interface BranchLineStatus {
  ref: Ref
  laneIndex: number
  color: string
  /** Number of commits reachable from this branch's tip but NOT from the
   * trunk (main/master). 0 for the trunk itself, or when no trunk ref
   * was found. Capped only by what's loaded in the windowed graph. */
  aheadOfTrunk: number
  /** Trunk branch name used for the count ("main" / "master"). Null when
   * neither exists in the repo, in which case the count is meaningless
   * and the tooltip says so. */
  trunkName: string | null
  status: 'passing' | 'open-pr' | 'stale' | 'conflict' | 'failing' | 'neutral'
}

/**
 * Count commits reachable from `tip` (walking parents) that are NOT in
 * `trunkSet`. Stops descending once it hits a trunk-reachable commit, so
 * the cost is proportional to the size of the divergent slice.
 */
function countCommitsAheadOfTrunk(
  tip: string,
  trunkSet: Set<string>,
  byHash: Map<string, GraphCommit>
): number {
  if (trunkSet.has(tip)) return 0
  const seen = new Set<string>()
  const queue: string[] = [tip]
  let count = 0
  while (queue.length > 0) {
    const h = queue.pop()!
    if (seen.has(h)) continue
    seen.add(h)
    if (trunkSet.has(h)) continue
    count++
    const c = byHash.get(h)
    if (!c) continue
    for (const p of c.parents) queue.push(p)
  }
  return count
}

/** Build the set of commits reachable from `start` by walking parents. */
function ancestorsOf(
  start: string,
  byHash: Map<string, GraphCommit>
): Set<string> {
  const out = new Set<string>()
  const queue: string[] = [start]
  while (queue.length > 0) {
    const h = queue.pop()!
    if (out.has(h)) continue
    out.add(h)
    const c = byHash.get(h)
    if (!c) continue
    for (const p of c.parents) queue.push(p)
  }
  return out
}

export function RefsSidebar(): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const status = useRepo((s) => s.status)
  const refs = useRepo((s) => s.refs)
  const graph = useRepo((s) => s.graph)
  const stashes = useRepo((s) => s.stashes)
  const busy = useRepo((s) => s.busy)
  const selectedCommit = useRepo((s) => s.selectedCommit)
  const setSelectedCommit = useRepo((s) => s.setSelectedCommit)
  const setStashView = useRepo((s) => s.setStashView)
  const setBusy = useRepo((s) => s.setBusy)
  const pushToast = useRepo((s) => s.pushToast)
  const refreshSignal = useRepo((s) => s.refreshSignal)
  const highlightedBranchId = useRepo((s) => s.highlightedBranchId)
  const setHighlightedBranchId = useRepo((s) => s.setHighlightedBranchId)
  const metroFilters = useRepo((s) => s.metroFilters)
  const setMetroFilters = useRepo((s) => s.setMetroFilters)
  const ciByCommit = useRepo((s) => s.ciByCommit)
  const ciAvailable = useRepo((s) => s.ciAvailable)

  // Resize
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      setSidebarWidth(
        Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startWidth + dx))
      )
    }
    const onUp = (): void => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent): void => {
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  const [open, setOpen] = useState<Record<SidebarSection, boolean>>({
    repo: true,
    currentBranch: true,
    localBranches: true,
    remoteBranches: false,
    filters: false,
    legend: false,
    stashes: true,
    tags: false
  })
  const toggle = (key: SidebarSection): void =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [branchFilter, setBranchFilter] = useState('')
  const [tagDeleteConfirm, setTagDeleteConfirm] = useState<string | null>(null)

  // Auto-expand both branch sections as soon as the user starts filtering
  // so matches in either list are immediately visible.
  useEffect(() => {
    if (branchFilter && (!open.localBranches || !open.remoteBranches)) {
      setOpen((prev) => ({
        ...prev,
        localBranches: true,
        remoteBranches: true
      }))
    }
  }, [branchFilter, open.localBranches, open.remoteBranches])
  const [branchDeleteConfirm, setBranchDeleteConfirm] = useState<
    { name: string; force: boolean } | null
  >(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<string[] | null>(null)
  const [checkoutConfirm, setCheckoutConfirm] = useState<{
    label: string
    action: () => Promise<void>
  } | null>(null)

  // Multi-selection for local branches. Keyed by `ref.fullName` so it
  // survives filter changes (a hidden-but-still-selected branch simply
  // doesn't render selected, and re-appears with selection intact when
  // the filter relaxes). The anchor ref tracks the last unmodified click
  // for shift-range extension.
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(
    () => new Set()
  )
  const lastClickedRef = useRef<string | null>(null)

  // Esc clears the multi-selection — matches the existing Esc-clears-filter
  // behaviour so the keyboard story is consistent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && selectedBranches.size > 0) {
        setSelectedBranches(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedBranches.size])

  const wipCount = useMemo(() => {
    if (!status) return 0
    return (
      status.staged.length +
      status.unstaged.length +
      status.untracked.length +
      status.conflicted.length
    )
  }, [status])

  // Compute branch lines with derived status. We share the metro map's
  // layout so each branch's color matches its line on the map exactly,
  // including the main-in-the-middle remapping. We pass the user's filter
  // toggles so we can flag which local branches are currently hidden from
  // the map (and dim them in the list to communicate the active filter).
  const ciByHash = useMemo(() => buildCiByHash(ciByCommit), [ciByCommit])
  const dateCutoffMs = useMemo(
    () => dateRangeCutoff(metroFilters.dateRange),
    [metroFilters.dateRange]
  )

  // Prefetch CI rollups for every local branch tip whenever the CI filter
  // is active. Without this, switching the dropdown to "Failing" would
  // appear to do nothing for branches whose CI hasn't been requested by
  // the map's frustum-cull yet. `useMapCi` is a no-op when ciAvailable is
  // false, and dedupes against the same cache the map uses, so the only
  // cost when the filter is off is a stable empty-array render.
  const tipHashesForCi = useMemo(() => {
    if (metroFilters.ciStatus === 'all') return []
    if (ciAvailable === false) return []
    return refs.local.map((r) => r.hash)
  }, [metroFilters.ciStatus, ciAvailable, refs.local])
  useMapCi(tipHashesForCi)

  const { branchLines, hiddenLocalNames } = useMemo(() => {
    if (!graph.length) {
      return { branchLines: [], hiddenLocalNames: new Set<string>() }
    }
    const layout = computeMetroLayout(graph, refs, status?.branch?.current ?? null, {
      showMerged: metroFilters.showMerged,
      showStale: metroFilters.showStale,
      ciFilter: metroFilters.ciStatus,
      ciByHash,
      author: metroFilters.author,
      dateCutoffMs
    })

    // Index the graph for parent-walk lookups + locate the trunk so we can
    // count "commits ahead of main/master" per branch.
    const byHash = new Map<string, GraphCommit>()
    for (const c of graph) byHash.set(c.hash, c)
    const trunkRef =
      refs.local.find((r) => r.name === 'main') ??
      refs.local.find((r) => r.name === 'master') ??
      null
    const trunkName = trunkRef ? trunkRef.name : null
    const trunkSet = trunkRef ? ancestorsOf(trunkRef.hash, byHash) : new Set<string>()

    // Always emit a row for every local branch (including hidden ones) so
    // users can still checkout / delete them; the visual dim comes from the
    // hiddenLocalNames set.
    const lines: BranchLineStatus[] = refs.local.map((r, idx) => {
      const laneIndex = layout.tipLane.get(r.hash) ?? idx
      const color = branchColor(r.name)
      const aheadOfTrunk = trunkRef
        ? r.fullName === trunkRef.fullName
          ? 0
          : countCommitsAheadOfTrunk(r.hash, trunkSet, byHash)
        : 0
      let st: BranchLineStatus['status'] = 'neutral'
      if (r.current) st = 'passing'
      else if (r.upstream) st = 'open-pr'
      else st = 'stale'
      return { ref: r, laneIndex, color, aheadOfTrunk, trunkName, status: st }
    })
    return { branchLines: lines, hiddenLocalNames: layout.hiddenLocalNames }
  }, [
    refs,
    graph,
    status?.branch?.current,
    metroFilters.showMerged,
    metroFilters.showStale,
    metroFilters.ciStatus,
    metroFilters.author,
    ciByHash,
    dateCutoffMs
  ])

  // Distinct authors from local branch TIPS (not every commit), keyed by
  // lowercased email. Sorted alphabetically by display name. We use the
  // tips because the filter operates on tips — showing every committer
  // who ever touched the repo would mostly produce dropdown entries that
  // never match anything.
  const authorOptions = useMemo(() => {
    const seen = new Map<string, string>() // email → name
    const byHash = new Map<string, GraphCommit>()
    for (const c of graph) byHash.set(c.hash, c)
    for (const r of refs.local) {
      const tip = byHash.get(r.hash)
      if (!tip?.email) continue
      const email = tip.email.toLowerCase()
      if (!seen.has(email)) seen.set(email, tip.author || email)
    }
    const sorted = [...seen.entries()].sort((a, b) =>
      a[1].localeCompare(b[1])
    )
    return [
      { value: '__all__', label: 'All authors' },
      ...sorted.map(([email, name]) => ({ value: email, label: name }))
    ]
  }, [refs.local, graph])

  // Group remote refs by their remote name (origin / upstream / fork / …)
  // so each can be folded independently within the Remote Branches section.
  const remoteGroups = useMemo(() => {
    const groups = new Map<string, Ref[]>()
    for (const r of refs.remote) {
      const slash = r.name.indexOf('/')
      const remoteName = slash > 0 ? r.name.slice(0, slash) : 'origin'
      const list = groups.get(remoteName) ?? []
      list.push(r)
      groups.set(remoteName, list)
    }
    return Array.from(groups.entries())
  }, [refs.remote])

  // Apply the live filter query. Always keep the current branch visible so
  // users don't lose context while typing.
  const filteredBranchLines = useMemo(() => {
    if (!branchFilter) return branchLines
    return branchLines.filter(
      (line) => line.ref.current || fuzzyMatches(line.ref.name, branchFilter)
    )
  }, [branchLines, branchFilter])

  const filteredRemoteGroups = useMemo(() => {
    if (!branchFilter) return remoteGroups
    return remoteGroups
      .map(([remoteName, remoteRefs]) => {
        // Match against the displayed name (without the remote/ prefix) so
        // typing "main" finds origin/main even though the ref name is
        // "origin/main".
        const matched = remoteRefs.filter((r) => {
          const localName = r.name.includes('/')
            ? r.name.slice(r.name.indexOf('/') + 1)
            : r.name
          return (
            fuzzyMatches(r.name, branchFilter) ||
            fuzzyMatches(localName, branchFilter)
          )
        })
        return [remoteName, matched] as [string, Ref[]]
      })
      .filter(([, list]) => list.length > 0)
  }, [remoteGroups, branchFilter])

  const filteredRemoteCount = useMemo(
    () => filteredRemoteGroups.reduce((acc, [, list]) => acc + list.length, 0),
    [filteredRemoteGroups]
  )

  if (!activeRepo) return <></>

  const runWithBusy = async (
    label: string,
    fn: () => Promise<{ ok: true } | { ok: false; stderr: string }>
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fn()
      if (res.ok) pushToast('success', `${label} succeeded`)
      else pushToast('error', `${label} failed: ${res.stderr}`)
      refreshSignal()
    } finally {
      setBusy(false)
    }
  }

  const doCheckoutLocal = (name: string): Promise<void> =>
    runWithBusy(`Checkout ${name}`, () =>
      window.git.branch.checkout(activeRepo.path, name)
    )
  const doCheckoutRemote = (name: string): Promise<void> =>
    runWithBusy(`Checkout ${name}`, () =>
      window.git.branch.checkoutRemote(activeRepo.path, name)
    )
  const checkoutLocal = (ref: { name: string; current?: boolean }): void => {
    if (ref.current) return
    if (wipCount > 0) {
      setCheckoutConfirm({ label: ref.name, action: () => doCheckoutLocal(ref.name) })
    } else {
      void doCheckoutLocal(ref.name)
    }
  }
  const checkoutRemote = (name: string): void => {
    if (wipCount > 0) {
      setCheckoutConfirm({ label: name, action: () => doCheckoutRemote(name) })
    } else {
      void doCheckoutRemote(name)
    }
  }

  const confirmDeleteBranch = async (): Promise<void> => {
    if (!branchDeleteConfirm) return
    const { name, force } = branchDeleteConfirm
    setBranchDeleteConfirm(null)
    await runWithBusy(
      `${force ? 'Force-delete' : 'Delete'} branch ${name}`,
      () => window.git.branch.delete(activeRepo!.path, name, { force })
    )
  }

  // Bulk delete: walk the list serially so we get a stable per-branch
  // success/error report (and don't hammer git with parallel ref writes).
  // We refresh and toast ONCE at the end rather than per-branch.
  const confirmBulkDelete = async (): Promise<void> => {
    if (!bulkDeleteConfirm || !activeRepo) return
    const names = bulkDeleteConfirm
    setBulkDeleteConfirm(null)
    if (busy) return
    setBusy(true)
    try {
      let okCount = 0
      const failures: Array<{ name: string; stderr: string }> = []
      for (const name of names) {
        const res = await window.git.branch.delete(activeRepo.path, name, {
          force: true
        })
        if (res.ok) okCount++
        else failures.push({ name, stderr: res.stderr })
      }
      if (okCount > 0) {
        pushToast(
          'success',
          `Deleted ${okCount} branch${okCount === 1 ? '' : 'es'}`
        )
      }
      if (failures.length > 0) {
        const preview = failures
          .slice(0, 3)
          .map((f) => f.name)
          .join(', ')
        pushToast(
          'error',
          `Failed to delete ${failures.length}: ${preview}` +
            (failures.length > 3 ? '…' : '')
        )
      }
      setSelectedBranches(new Set())
      lastClickedRef.current = null
      refreshSignal()
    } finally {
      setBusy(false)
    }
  }

  // Open the context menu for a single branch (right-clicked outside any
  // multi-selection, or inside a single-row "selection" of just that one).
  const openSingleBranchMenu = (e: React.MouseEvent, ref: Ref): void => {
    const currentBranch = refs.local.find((r) => r.current)?.name
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Checkout', onClick: () => checkoutLocal(ref), disabled: !!ref.current },
        { type: 'separator' },
        {
          label: `Push ${ref.name}`,
          onClick: () => runWithBusy(`Push ${ref.name}`, () =>
            window.git.remote.push(activeRepo!.path, { branch: ref.name })
          )
        },
        {
          label: `Pull ${ref.name}`,
          onClick: () => runWithBusy(`Pull ${ref.name}`, () =>
            window.git.remote.pull(activeRepo!.path, { branch: ref.name })
          )
        },
        { type: 'separator' },
        {
          label: currentBranch
            ? `Rebase ${currentBranch} onto ${ref.name}`
            : `Rebase onto ${ref.name}`,
          disabled: !!ref.current,
          onClick: () =>
            runWithBusy(
              `Rebase onto ${ref.name}`,
              () => window.git.rebase.onto(activeRepo!.path, ref.name)
            )
        },
        { type: 'separator' },
        { label: 'Highlight on map', onClick: () => setHighlightedBranchId(ref.fullName) },
        {
          label: 'Clear highlight',
          onClick: () => setHighlightedBranchId(null),
          disabled: highlightedBranchId !== ref.fullName
        },
        { type: 'separator' },
        {
          label: 'Copy name',
          onClick: () => {
            navigator.clipboard?.writeText(ref.name)
            pushToast('success', 'Name copied')
          }
        },
        { type: 'separator' },
        {
          label: 'Delete branch',
          danger: true,
          disabled: !!ref.current,
          onClick: () => setBranchDeleteConfirm({ name: ref.name, force: true })
        }
      ]
    })
  }

  // Open the multi-branch context menu when right-clicking inside a
  // multi-selection. The current branch (HEAD) is excluded from the
  // delete list — git refuses to delete it and we don't want to surprise
  // the user with a partial failure.
  const openMultiBranchMenu = (
    e: React.MouseEvent,
    selectedNames: string[]
  ): void => {
    const deletable = selectedNames.filter((n) => {
      const r = refs.local.find((x) => x.fullName === n)
      return r && !r.current
    })
    const skippedCurrent = selectedNames.length - deletable.length
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: `${selectedNames.length} branches selected`,
          disabled: true,
          onClick: () => {}
        },
        { type: 'separator' },
        {
          label: 'Copy names',
          onClick: () => {
            const names = selectedNames
              .map((fn) => refs.local.find((r) => r.fullName === fn)?.name)
              .filter((x): x is string => !!x)
            navigator.clipboard?.writeText(names.join('\n'))
            pushToast('success', `Copied ${names.length} names`)
          }
        },
        { type: 'separator' },
        {
          label:
            `Delete ${deletable.length} branch${deletable.length === 1 ? '' : 'es'}` +
            (skippedCurrent > 0 ? ' (current branch skipped)' : ''),
          danger: true,
          disabled: deletable.length === 0,
          onClick: () => {
            const names = deletable
              .map((fn) => refs.local.find((r) => r.fullName === fn)?.name)
              .filter((x): x is string => !!x)
            setBulkDeleteConfirm(names)
          }
        }
      ]
    })
  }

  const onBranchLineContext = (e: React.MouseEvent, ref: Ref): void => {
    e.preventDefault()
    e.stopPropagation()
    // If the right-clicked branch is part of a multi-selection (size 2+),
    // operate on the whole selection. Otherwise replace the selection
    // with just this branch and show the single-branch menu.
    if (selectedBranches.has(ref.fullName) && selectedBranches.size > 1) {
      openMultiBranchMenu(e, [...selectedBranches])
    } else {
      setSelectedBranches(new Set([ref.fullName]))
      lastClickedRef.current = ref.fullName
      openSingleBranchMenu(e, ref)
    }
  }

  const scrollToRef = (ref: Ref): void => {
    // Highlight the branch line on the map.
    setHighlightedBranchId(ref.fullName)
    // Scroll the metro map to the branch tip and select it.
    window.dispatchEvent(
      new CustomEvent('gitmetro:scroll-to-commit', { detail: { hash: ref.hash } })
    )
  }

  // Click router for a branch row. Modifier-aware:
  //   • plain click  → single-select + scroll to tip on the map
  //   • cmd/ctrl     → toggle this branch in/out of the selection
  //   • shift        → extend selection from the anchor to this row
  // The visible list (`filteredBranchLines`) is passed in so range
  // selection only walks rows the user can actually see.
  const onBranchLineClick = (
    e: React.MouseEvent,
    ref: Ref,
    visibleList: BranchLineStatus[],
    rowIndex: number
  ): void => {
    if (e.button !== 0) return
    const fullName = ref.fullName

    if (e.shiftKey && lastClickedRef.current) {
      const anchorIdx = visibleList.findIndex(
        (l) => l.ref.fullName === lastClickedRef.current
      )
      if (anchorIdx >= 0) {
        const [start, end] =
          anchorIdx <= rowIndex ? [anchorIdx, rowIndex] : [rowIndex, anchorIdx]
        const next = new Set(selectedBranches)
        for (let i = start; i <= end; i++) next.add(visibleList[i].ref.fullName)
        setSelectedBranches(next)
        e.preventDefault()
        return
      }
    }

    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedBranches)
      if (next.has(fullName)) next.delete(fullName)
      else next.add(fullName)
      setSelectedBranches(next)
      lastClickedRef.current = fullName
      e.preventDefault()
      return
    }

    // Plain click: single-select + map navigation.
    setSelectedBranches(new Set([fullName]))
    lastClickedRef.current = fullName
    scrollToRef(ref)
  }

  const popStash = (idx: number): Promise<void> =>
    runWithBusy(`Pop stash@{${idx}}`, () => window.git.stash.pop(activeRepo.path, idx))
  const applyStash = (idx: number): Promise<void> =>
    runWithBusy(`Apply stash@{${idx}}`, () => window.git.stash.apply(activeRepo.path, idx))
  const dropStash = (idx: number): Promise<void> =>
    runWithBusy(`Drop stash@{${idx}}`, () => window.git.stash.drop(activeRepo.path, idx))

  const checkoutTag = (hash: string): Promise<void> =>
    runWithBusy('Checkout tag', () =>
      window.git.branch.checkoutDetached(activeRepo.path, hash)
    )

  const handleDeleteTag = async (name: string): Promise<void> => {
    if (tagDeleteConfirm !== name) {
      setTagDeleteConfirm(name)
      setTimeout(() => setTagDeleteConfirm((c) => (c === name ? null : c)), 3000)
      return
    }
    setTagDeleteConfirm(null)
    await runWithBusy(`Delete tag ${name}`, () =>
      window.git.tag.delete(activeRepo.path, name)
    )
  }

  const onTagContext = (e: React.MouseEvent, ref: Ref): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Checkout (detached)', onClick: () => checkoutTag(ref.hash) },
        {
          label: 'Copy name',
          onClick: () => {
            navigator.clipboard?.writeText(ref.name)
            pushToast('success', 'Name copied')
          }
        },
        { type: 'separator' },
        {
          label: tagDeleteConfirm === ref.name ? 'Confirm delete?' : 'Delete tag',
          danger: true,
          onClick: () => handleDeleteTag(ref.name)
        }
      ]
    })
  }

  const repoHost = activeRepo.path.split('/').slice(-2).join('/')

  return (
    <aside
      className="bg-bg-subtle border-r border-line flex flex-row shrink-0"
      style={{ width: sidebarWidth }}
    >
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Repository */}
          <Section
            title="Repository"
            open={open.repo}
            onToggle={() => toggle('repo')}
          >
            <div className="px-3 py-2 flex items-start gap-2">
              <div className="w-7 h-7 rounded bg-accent/10 border border-accent/30 text-accent flex items-center justify-center shrink-0">
                <Folder size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" title={activeRepo.path}>
                  {activeRepo.name}
                </div>
                <div className="text-[11px] text-muted truncate" title={activeRepo.path}>
                  {repoHost}
                </div>
              </div>
            </div>
          </Section>

          {/* Working copy / WIP node */}
          <div
            onClick={() => setSelectedCommit(null)}
            onContextMenu={(e) => {
              if (wipCount === 0) return
              e.preventDefault()
              e.stopPropagation()
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    label: `Discard all ${wipCount} change${wipCount === 1 ? '' : 's'}…`,
                    danger: true,
                    onClick: () =>
                      runWithBusy('Discard all changes', () =>
                        window.git.branch.resetHard(activeRepo!.path)
                      )
                  }
                ]
              })
            }}
            className={
              'cursor-pointer px-3 py-2 border-b border-line flex items-center justify-between ' +
              (selectedCommit === null ? 'bg-accent/15' : 'hover:bg-bg-panel')
            }
          >
            <div className="flex items-center gap-2 min-w-0">
              <CircleDot size={14} className={wipCount > 0 ? 'text-warn' : 'text-success'} />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium">//WIP</span>
                <span className="text-[11px] text-muted">
                  {wipCount === 0 ? 'working tree clean' : `${wipCount} uncommitted change${wipCount === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
            {wipCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-warn/20 text-warn font-mono">
                {wipCount}
              </span>
            )}
          </div>

          {/* Branch search — always visible, no collapse, fuzzy-matches both
              local and remote names as you type. */}
          <div className="px-2 py-2 border-b border-line">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setBranchFilter('')
                }}
                placeholder="Filter branches…"
                className="w-full pl-7 pr-7 py-1 bg-bg-panel border border-line rounded text-[12px] focus:outline-none focus:border-accent placeholder:text-muted"
              />
              {branchFilter && (
                <button
                  onClick={() => setBranchFilter('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  title="Clear filter (Esc)"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Current Branch */}
          {(() => {
            const currentLine = branchLines.find((l) => l.ref.current)
            if (!currentLine) return null
            const isHighlighted = highlightedBranchId === currentLine.ref.fullName
            return (
              <Section
                title="Current Branch"
                open={open.currentBranch}
                onToggle={() => toggle('currentBranch')}
                icon={<TramFront size={12} className="text-accent" />}
              >
                <BranchLineRow
                  line={currentLine}
                  query=""
                  highlighted={isHighlighted}
                  anyHighlighted={highlightedBranchId !== null}
                  hiddenByFilter={false}
                  selected={false}
                  onClick={() =>
                    setHighlightedBranchId(isHighlighted ? null : currentLine.ref.fullName)
                  }
                  onDoubleClick={() => {}}
                  onContextMenu={(e) => onBranchLineContext(e, currentLine.ref)}
                  onCheckout={() => {}}
                />
              </Section>
            )
          })()}

          {/* Local Branches */}
          <Section
            title="Local Branches"
            open={open.localBranches}
            onToggle={() => toggle('localBranches')}
            count={
              branchFilter
                ? filteredBranchLines.length
                : branchLines.length
            }
            icon={<Monitor size={12} className="text-muted" />}
          >
            {branchLines.length === 0 ? (
              <Empty text="No local branches" />
            ) : filteredBranchLines.length === 0 ? (
              <Empty text="No matches" />
            ) : (
              filteredBranchLines.map((line, idx) => (
                <BranchLineRow
                  key={line.ref.fullName}
                  line={line}
                  query={branchFilter}
                  highlighted={highlightedBranchId === line.ref.fullName}
                  anyHighlighted={highlightedBranchId !== null}
                  hiddenByFilter={hiddenLocalNames.has(line.ref.name)}
                  selected={selectedBranches.has(line.ref.fullName)}
                  onClick={(e) =>
                    onBranchLineClick(e, line.ref, filteredBranchLines, idx)
                  }
                  onDoubleClick={() => checkoutLocal(line.ref)}
                  onContextMenu={(e) => onBranchLineContext(e, line.ref)}
                  onCheckout={() => checkoutLocal(line.ref)}
                />
              ))
            )}
          </Section>

          {/* Remote Branches — grouped by remote name so origin / upstream /
              fork can each be reviewed independently. */}
          <Section
            title="Remote Branches"
            open={open.remoteBranches}
            onToggle={() => toggle('remoteBranches')}
            count={branchFilter ? filteredRemoteCount : refs.remote.length}
            icon={<Cloud size={12} className="text-muted" />}
          >
            {remoteGroups.length === 0 ? (
              <Empty text="No remotes" />
            ) : filteredRemoteGroups.length === 0 ? (
              <Empty text="No matches" />
            ) : (
              filteredRemoteGroups.map(([remoteName, remoteRefs]) => (
                <div key={remoteName}>
                  {filteredRemoteGroups.length > 1 && (
                    <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted">
                      {remoteName}
                    </div>
                  )}
                  {remoteRefs.map((r) => {
                    const localName = r.name.includes('/')
                      ? r.name.slice(r.name.indexOf('/') + 1)
                      : r.name
                    return (
                      <RemoteRow
                        key={r.fullName}
                        refData={r}
                        color={branchColor(localName)}
                        displayName={localName}
                        query={branchFilter}
                        onClick={() => scrollToRef(r)}
                        onCheckout={() => checkoutRemote(r.name)}
                      />
                    )
                  })}
                </div>
              ))
            )}
          </Section>

          {/* Visibility — what's shown on the map. Both toggles and
              dropdowns apply at the BRANCH level (lanes are dropped
              entirely when their tip doesn't match), not per-commit. */}
          <Section
            title="Visibility"
            open={open.filters}
            onToggle={() => toggle('filters')}
            count={hiddenLocalNames.size > 0 ? hiddenLocalNames.size : undefined}
          >
            <ToggleRow
              label="Show merged"
              checked={metroFilters.showMerged}
              onChange={(v) => setMetroFilters({ showMerged: v })}
            />
            <ToggleRow
              label="Show stale"
              checked={metroFilters.showStale}
              onChange={(v) => setMetroFilters({ showStale: v })}
            />
            <FilterSelect<CiFilter>
              label="CI status"
              value={metroFilters.ciStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'passing', label: 'Passing' },
                { value: 'failing', label: 'Failing' },
                { value: 'pending', label: 'Pending' },
                { value: 'none', label: 'No checks' }
              ]}
              onChange={(v) => setMetroFilters({ ciStatus: v })}
              disabled={ciAvailable === false}
              disabledTitle="gh CLI is not installed or authenticated — install it and run `gh auth login` to enable CI filters."
            />
            <FilterSelect<string>
              label="Author"
              value={metroFilters.author ?? '__all__'}
              options={authorOptions}
              onChange={(v) =>
                setMetroFilters({ author: v === '__all__' ? null : v })
              }
              disabled={authorOptions.length <= 1}
              disabledTitle="No branch-tip authors loaded yet."
            />
            <FilterSelect<DateRangeFilter>
              label="Date range"
              value={metroFilters.dateRange}
              options={[
                { value: 'all', label: 'Any time' },
                { value: '7d', label: 'Last 7 days' },
                { value: '30d', label: 'Last 30 days' },
                { value: '90d', label: 'Last 90 days' }
              ]}
              onChange={(v) => setMetroFilters({ dateRange: v })}
            />
            {hiddenLocalNames.size > 0 && (
              <div className="px-3 pt-1.5 pb-1 text-[10px] text-muted">
                Hiding {hiddenLocalNames.size} branch
                {hiddenLocalNames.size === 1 ? '' : 'es'}:{' '}
                <span className="font-mono">
                  {[...hiddenLocalNames].slice(0, 3).join(', ')}
                  {hiddenLocalNames.size > 3
                    ? `, +${hiddenLocalNames.size - 3} more`
                    : ''}
                </span>
              </div>
            )}
            {(metroFilters.ciStatus !== 'all' ||
              metroFilters.author !== null ||
              metroFilters.dateRange !== 'all' ||
              !metroFilters.showMerged ||
              metroFilters.showStale) && (
              <div className="px-3 pt-0.5 pb-1.5">
                <button
                  onClick={() =>
                    setMetroFilters({
                      showMerged: true,
                      showStale: false,
                      ciStatus: 'all',
                      author: null,
                      dateRange: 'all'
                    })
                  }
                  className="text-[10px] text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </Section>

          {/* Legend */}
          <Section
            title="Legend"
            open={open.legend}
            onToggle={() => toggle('legend')}
          >
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-2 text-[11px] text-muted">
              <LegendItem icon={<Circle size={11} className="text-accent" />} label="Commit" />
              <LegendItem icon={<TramFront size={11} className="text-accent" />} label="Train (PR)" />
              <LegendItem icon={<GitMerge size={11} className="text-accent" />} label="Merge / Interchange" />
              <LegendItem icon={<CheckCircle2 size={11} className="text-success" />} label="CI Passing" />
              <LegendItem icon={<Flag size={11} className="text-success" />} label="Release / Tag" />
              <LegendItem icon={<XCircle size={11} className="text-danger" />} label="CI Failing" />
              <LegendItem icon={<EyeOff size={11} className="text-muted" />} label="Stale Branch" />
            </div>
          </Section>

          {/* Stashes */}
          <Section
            title="Stashes"
            open={open.stashes}
            onToggle={() => toggle('stashes')}
            count={stashes.length}
          >
            {stashes.length === 0 ? (
              <Empty text="No stashes" />
            ) : (
              stashes.map((s) => (
                <StashRow
                  key={s.index}
                  stash={s}
                  cwd={activeRepo.path}
                  onPop={() => popStash(s.index)}
                  onApply={() => applyStash(s.index)}
                  onDrop={() => dropStash(s.index)}
                  onSelectFile={(path) => setStashView({ stashIndex: s.index, filePath: path })}
                  onApplyFile={async (path) => {
                    const res = await window.git.stash.applyFile(activeRepo.path, s.index, path)
                    if (res.ok) {
                      pushToast('success', `Applied ${path} from stash`)
                      refreshSignal()
                    } else {
                      pushToast('error', `Apply failed: ${res.stderr}`)
                    }
                  }}
                />
              ))
            )}
          </Section>

          {/* Tags */}
          <Section
            title="Tags"
            open={open.tags}
            onToggle={() => toggle('tags')}
            count={refs.tags.length}
          >
            {refs.tags.length === 0 ? (
              <Empty text="No tags" />
            ) : (
              refs.tags.map((t) => (
                <div
                  key={t.fullName}
                  onDoubleClick={() => checkoutTag(t.hash)}
                  onContextMenu={(e) => onTagContext(e, t)}
                  className="group px-3 py-1 hover:bg-bg-panel cursor-pointer flex items-center gap-2"
                  title={t.fullName}
                >
                  <Flag size={11} className="text-warn shrink-0" />
                  <span className="truncate text-sm flex-1 font-mono">{t.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteTag(t.name)
                    }}
                    className={
                      'opacity-0 group-hover:opacity-100 text-xs ' +
                      (tagDeleteConfirm === t.name
                        ? 'text-danger font-semibold animate-pulse'
                        : 'text-muted hover:text-danger')
                    }
                    title={tagDeleteConfirm === t.name ? 'Click again to confirm' : 'Delete tag'}
                  >
                    {tagDeleteConfirm === t.name ? 'Confirm?' : '✕'}
                  </button>
                </div>
              ))
            )}
          </Section>

          {/* Repo footer link */}
          <div className="px-3 py-3 border-t border-line">
            <button className="w-full px-3 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium flex items-center justify-center gap-2">
              <Github size={13} />
              <span>View on GitHub</span>
            </button>
          </div>
        </div>

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}

        {branchDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-bg-panel border border-line rounded-lg shadow-xl p-5 w-[340px] flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-danger">Delete branch?</span>
                <span className="text-xs text-muted">
                  This will delete{' '}
                  <span className="font-mono text-text">{branchDeleteConfirm.name}</span>
                  {' '}locally. The remote branch is not affected.
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setBranchDeleteConfirm(null)}
                  className="px-3 py-1.5 rounded text-sm border border-line hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void confirmDeleteBranch()}
                  className="px-3 py-1.5 rounded text-sm bg-danger text-white hover:opacity-90"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {bulkDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-bg-panel border border-line rounded-lg shadow-xl p-5 w-[380px] flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-danger">
                  Delete {bulkDeleteConfirm.length} branch
                  {bulkDeleteConfirm.length === 1 ? '' : 'es'}?
                </span>
                <span className="text-xs text-muted">
                  These will be force-deleted locally. Remote branches are not affected.
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto rounded border border-line bg-bg-subtle/40 p-2">
                <ul className="text-xs font-mono space-y-0.5">
                  {bulkDeleteConfirm.map((name) => (
                    <li key={name} className="truncate" title={name}>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setBulkDeleteConfirm(null)}
                  className="px-3 py-1.5 rounded text-sm border border-line hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void confirmBulkDelete()}
                  className="px-3 py-1.5 rounded text-sm bg-danger text-white hover:opacity-90"
                >
                  Delete {bulkDeleteConfirm.length}
                </button>
              </div>
            </div>
          </div>
        )}

        {checkoutConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-bg-panel border border-line rounded-lg shadow-xl p-5 w-[340px] flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Checkout with uncommitted changes?</span>
                <span className="text-xs text-muted">
                  You have {wipCount} uncommitted change{wipCount === 1 ? '' : 's'}.
                  Switching to <span className="font-mono text-text">{checkoutConfirm.label}</span> may
                  overwrite or discard them.
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCheckoutConfirm(null)}
                  className="px-3 py-1.5 rounded text-sm border border-line hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const action = checkoutConfirm.action
                    setCheckoutConfirm(null)
                    void action()
                  }}
                  className="px-3 py-1.5 rounded text-sm bg-accent text-white hover:bg-accent-hover"
                >
                  Checkout anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        className="w-1 cursor-ew-resize hover:bg-accent/40 active:bg-accent/60 shrink-0"
        title="Drag to resize"
      />
    </aside>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  open: boolean
  onToggle: () => void
  count?: number
  icon?: JSX.Element
  children: React.ReactNode
}

function Section({
  title,
  open,
  onToggle,
  count,
  icon,
  children
}: SectionProps): JSX.Element {
  return (
    <div className="border-b border-line">
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-bg-panel"
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          <span className="text-[11px] uppercase tracking-wider text-muted font-medium">{title}</span>
        </div>
        {count !== undefined && <span className="text-[11px] text-muted">{count}</span>}
      </button>
      {open && <div className="pb-1.5">{children}</div>}
    </div>
  )
}

interface BranchLineRowProps {
  line: BranchLineStatus
  query: string
  highlighted: boolean
  anyHighlighted: boolean
  hiddenByFilter: boolean
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onCheckout: () => void
}

function BranchLineRow({
  line,
  query,
  highlighted,
  anyHighlighted,
  hiddenByFilter,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onCheckout
}: BranchLineRowProps): JSX.Element {
  const { ref, color, aheadOfTrunk, trunkName } = line
  // A row in a multi-selection should not be dimmed even if the map's
  // single-branch highlight points elsewhere — multi-select intent
  // outranks the highlight dim.
  const dim = (anyHighlighted && !highlighted && !selected) || hiddenByFilter
  const titleSuffix = hiddenByFilter ? '\nHidden by current filter' : ''

  // Badge tooltip explains what the count actually means. Singular/plural
  // tweak avoids "1 commits", and we call out the trunk (the branch we're
  // measuring against) so it's not ambiguous in repos with both main and
  // master, develop, etc.
  const badgeTooltip = !trunkName
    ? 'No trunk branch (main/master) found — count unavailable'
    : ref.name === trunkName
      ? `${trunkName} is the trunk`
      : `${aheadOfTrunk} commit${aheadOfTrunk === 1 ? '' : 's'} ahead of ${trunkName}`

  // Selection ring outranks the (lighter) map-highlight bg so multi-select
  // reads clearly.
  const rowBg = selected
    ? 'bg-accent/30 ring-1 ring-inset ring-accent/60'
    : highlighted
      ? 'bg-accent/15'
      : 'hover:bg-bg-panel'

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={'group relative px-3 py-1 cursor-pointer flex items-center gap-2 ' + rowBg}
      style={{ opacity: dim ? 0.45 : 1 }}
      title={ref.fullName + titleSuffix}
    >
      {/* Color line swatch */}
      <span
        className="w-1 h-5 rounded-sm shrink-0"
        style={{ backgroundColor: color }}
      />
      <span
        className={
          'truncate text-sm flex-1 font-mono text-[12px] ' +
          (ref.current ? 'text-text font-semibold' : 'text-text')
        }
        style={{ color: highlighted ? color : undefined }}
      >
        <HighlightedName name={ref.name} query={query} />
      </span>
      <span
        className="text-[10px] font-mono px-1 rounded shrink-0"
        style={{
          backgroundColor: `${color}33`,
          color
        }}
        title={badgeTooltip}
      >
        {trunkName ? aheadOfTrunk : '—'}
      </span>
      {!ref.current && (
        <button
          onClick={(e) => { e.stopPropagation(); onCheckout() }}
          className="absolute right-2 opacity-0 group-hover:opacity-100 text-[10px] text-accent hover:text-accent-hover bg-bg-panel px-1 rounded"
        >
          Checkout
        </button>
      )}
    </div>
  )
}


interface RemoteRowProps {
  refData: Ref
  color: string
  displayName: string
  query: string
  onClick: () => void
  onCheckout: () => void
}

function RemoteRow({
  refData,
  color,
  displayName,
  query,
  onClick,
  onCheckout
}: RemoteRowProps): JSX.Element {
  return (
    <div
      className="group px-3 py-1 hover:bg-bg-panel cursor-pointer flex items-center gap-2"
      title={refData.fullName}
      onClick={onClick}
      onDoubleClick={onCheckout}
    >
      <span
        className="w-1 h-5 rounded-sm shrink-0 opacity-50"
        style={{ backgroundColor: color }}
      />
      <GitPullRequest size={11} className="text-muted shrink-0" />
      <span className="truncate text-[12px] flex-1 font-mono text-muted">
        <HighlightedName name={displayName} query={query} />
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onCheckout() }}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-accent hover:text-accent-hover shrink-0"
      >
        Checkout
      </button>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 px-3 py-1 cursor-pointer hover:bg-bg-panel text-[12px]">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={
          'w-7 h-4 rounded-full transition-colors relative ' +
          (checked ? 'bg-accent' : 'bg-line')
        }
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(14px)' : 'translateX(2px)' }}
        />
      </button>
    </label>
  )
}

interface FilterSelectProps<T extends string> {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
  disabledTitle?: string
}

/**
 * Native `<select>` styled to match the sidebar's other rows. Native
 * elements get correct keyboard handling, screen-reader semantics, and
 * platform-correct popup positioning for free.
 */
function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  disabledTitle
}: FilterSelectProps<T>): JSX.Element {
  return (
    <label
      className={
        'flex items-center justify-between gap-2 px-3 py-1 text-[12px] ' +
        (disabled ? 'opacity-60' : '')
      }
      title={disabled ? disabledTitle : undefined}
    >
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="px-2 py-0.5 rounded bg-bg-panel border border-line text-[11px] text-text focus:outline-none focus:border-accent disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function LegendItem({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span>{label}</span>
    </div>
  )
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="px-3 py-1.5 text-[11px] text-muted italic">{text}</div>
}

// ── Stashes (preserved from previous sidebar) ──────────────────────────────

interface StashRowProps {
  stash: Stash
  cwd: string
  onPop: () => void
  onApply: () => void
  onDrop: () => void
  onSelectFile: (path: string) => void
  onApplyFile: (path: string) => Promise<void>
}

function StashRow({
  stash, cwd, onPop, onApply, onDrop, onSelectFile, onApplyFile
}: StashRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [files, setFiles] = useState<StashFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileCtxMenu, setFileCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null)

  const toggleExpand = async (): Promise<void> => {
    if (!expanded && files.length === 0) {
      setFilesLoading(true)
      const res = await window.git.stash.files(cwd, stash.index)
      setFilesLoading(false)
      if (res.ok) setFiles(res.data)
    }
    setExpanded((v) => !v)
  }

  const statusBadge = (s: StashFileEntry['status']): { label: string; cls: string } => {
    switch (s) {
      case 'A': return { label: 'A', cls: 'text-success' }
      case 'D': return { label: 'D', cls: 'text-danger' }
      case 'R': return { label: 'R', cls: 'text-warn' }
      default:  return { label: 'M', cls: 'text-accent' }
    }
  }

  return (
    <div className="border-b border-line/40 last:border-b-0">
      <div
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setRowMenu({ x: e.clientX, y: e.clientY }) }}
        className="group px-2 py-1.5 hover:bg-bg-panel cursor-default flex items-center gap-1.5"
        title={`stash@{${stash.index}} · ${stash.relativeDate}`}
      >
        <button onClick={toggleExpand} className="text-muted hover:text-text text-xs shrink-0 w-3">
          {expanded ? '▾' : '▸'}
        </button>
        <Archive className="shrink-0 text-muted" size={11} />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={toggleExpand}>
          <div className="truncate text-[12px]">{stash.message || `stash@{${stash.index}}`}</div>
          <div className="text-[10px] text-muted truncate">
            {stash.branch ? `on ${stash.branch} · ` : ''}{stash.relativeDate}
          </div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
          <button onClick={onPop} className="text-[10px] text-accent hover:text-accent-hover">Pop</button>
          <button onClick={onDrop} className="text-[10px] text-danger hover:opacity-80">Drop</button>
        </div>
      </div>

      {expanded && (
        <div className="pb-1">
          {filesLoading ? (
            <div className="pl-8 py-1 text-[10px] text-muted italic">Loading...</div>
          ) : files.length === 0 ? (
            <div className="pl-8 py-1 text-[10px] text-muted italic">No files</div>
          ) : (
            files.map((f) => {
              const badge = statusBadge(f.status)
              return (
                <div
                  key={f.path}
                  onClick={() => { setActiveFile(f.path); onSelectFile(f.path) }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setFileCtxMenu({ x: e.clientX, y: e.clientY, path: f.path })
                  }}
                  className={
                    'flex items-center gap-1.5 pl-8 pr-2 py-0.5 text-[11px] cursor-pointer ' +
                    (activeFile === f.path ? 'bg-accent/20' : 'hover:bg-bg-panel')
                  }
                  title={f.path}
                >
                  <span className={`font-mono w-3 shrink-0 ${badge.cls}`}>{badge.label}</span>
                  <span className="flex-1 truncate font-mono">{f.path}</span>
                </div>
              )
            })
          )}
        </div>
      )}

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={[
            { label: 'Pop', onClick: onPop },
            { label: 'Apply', onClick: onApply },
            { type: 'separator' },
            { label: 'Drop', onClick: onDrop, danger: true }
          ]}
          onClose={() => setRowMenu(null)}
        />
      )}

      {fileCtxMenu && (
        <ContextMenu
          x={fileCtxMenu.x}
          y={fileCtxMenu.y}
          items={[
            {
              label: 'Apply this file to working tree',
              onClick: () => { void onApplyFile(fileCtxMenu.path); setFileCtxMenu(null) }
            },
            { type: 'separator' },
            {
              label: 'Copy file path',
              onClick: () => navigator.clipboard.writeText(fileCtxMenu.path)
            }
          ]}
          onClose={() => setFileCtxMenu(null)}
        />
      )}
    </div>
  )
}
