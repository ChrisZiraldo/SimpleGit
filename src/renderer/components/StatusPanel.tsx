import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRepo } from '../store/useRepo'
import type { FileChangeType, FileEntry } from '@shared/types'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ConflictEditor } from './ConflictEditor'

// ── Tree helpers ─────────────────────────────────────────────────────────────

interface DirNode {
  kind: 'dir'
  name: string
  /** Full relative path of this directory, e.g. "src/renderer" */
  path: string
  children: TreeNode[]
}
interface FileNode {
  kind: 'file'
  name: string
  entry: FileEntry
}
type TreeNode = DirNode | FileNode

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] }

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      const dirPath = parts.slice(0, i + 1).join('/')
      let child = cur.children.find((c): c is DirNode => c.kind === 'dir' && c.name === seg)
      if (!child) {
        child = { kind: 'dir', name: seg, path: dirPath, children: [] }
        cur.children.push(child)
      }
      cur = child
    }
    cur.children.push({ kind: 'file', name: parts[parts.length - 1], entry })
  }

  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.kind === 'dir') n.children = sort(n.children)
    return nodes
  }

  return sort(root.children)
}

interface Props {
  onRefresh: () => Promise<void>
}

function changeBadge(entry: FileEntry): { label: string; cls: string } {
  switch (entry.changeType) {
    case 'added':
      return { label: 'A', cls: 'text-success' }
    case 'modified':
      return { label: 'M', cls: 'text-accent' }
    case 'deleted':
      return { label: 'D', cls: 'text-danger' }
    case 'renamed':
      return { label: 'R', cls: 'text-warn' }
    case 'copied':
      return { label: 'C', cls: 'text-warn' }
    case 'untracked':
      return { label: '?', cls: 'text-muted' }
    case 'unmerged':
      return { label: '!', cls: 'text-danger' }
    case 'ignored':
      return { label: 'I', cls: 'text-muted' }
    default:
      return { label: ' ', cls: 'text-muted' }
  }
}

export function StatusPanel({ onRefresh }: Props): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const status = useRepo((s) => s.status)
  const selectedFile = useRepo((s) => s.selectedFile)
  const setSelectedFile = useRepo((s) => s.setSelectedFile)
  const pushToast = useRepo((s) => s.pushToast)

  // Persist view mode in localStorage so it survives refreshes
  const [viewMode, setViewMode] = useState<'path' | 'tree'>(() => {
    return (localStorage.getItem('statusPanelViewMode') as 'path' | 'tree') ?? 'path'
  })
  const setView = (mode: 'path' | 'tree'): void => {
    localStorage.setItem('statusPanelViewMode', mode)
    setViewMode(mode)
  }

  // Track which file key (path:staged) is in pending-confirm state for discard
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null)
  const [conflictFile, setConflictFile] = useState<string | null>(null)

  // Multi-select: keys are "path:staged" strings
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<{ key: string; section: 'unstaged' | 'staged' } | null>(null)

  const multiKey = (path: string, staged: boolean): string => `${path}:${staged}`

  // Listen for conflict-badge click from the metro map
  useEffect(() => {
    const handler = (): void => {
      const first = useRepo.getState().status?.conflicted[0]?.path
      if (first) setConflictFile(first)
    }
    window.addEventListener('gitmetro:open-conflicts', handler)
    return () => window.removeEventListener('gitmetro:open-conflicts', handler)
  }, [])
  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const unstagedAll = useMemo(
    () => [...(status?.unstaged ?? []), ...(status?.untracked ?? [])],
    [status]
  )
  const stagedAll = status?.staged ?? []
  const conflicted = status?.conflicted ?? []

  if (!activeRepo) return <></>

  const stage = async (paths: string[]): Promise<void> => {
    const res = await window.git.stage.add(activeRepo.path, paths)
    if (!res.ok) pushToast('error', `Stage failed: ${res.stderr}`)
    await onRefresh()
  }

  const unstage = async (paths: string[]): Promise<void> => {
    const res = await window.git.stage.reset(activeRepo.path, paths)
    if (!res.ok) pushToast('error', `Unstage failed: ${res.stderr}`)
    await onRefresh()
  }

  const discard = async (
    path: string,
    staged: boolean,
    changeType: FileChangeType
  ): Promise<void> => {
    const key = `${path}:${staged}`
    if (pendingDiscard !== key) {
      setPendingDiscard(key)
      setTimeout(() => setPendingDiscard((cur) => (cur === key ? null : cur)), 3000)
      return
    }
    setPendingDiscard(null)
    const res = await window.git.stage.discard(activeRepo.path, path, staged, changeType)
    if (!res.ok) pushToast('error', `Discard failed: ${res.stderr}`)
    else pushToast('info', `Discarded ${path}`)
    if (selectedFile?.path === path) setSelectedFile(null)
    await onRefresh()
  }

  const select = (path: string, staged: boolean): void => {
    setPendingDiscard(null)
    setMultiSelected(new Set())
    setSelectedFile({ path, staged })
  }

  const isSelected = (path: string, staged: boolean): boolean =>
    selectedFile?.path === path && selectedFile?.staged === staged

  const discardKey = (path: string, staged: boolean): string => `${path}:${staged}`

  const discardMultiple = useCallback(async (entries: FileEntry[]): Promise<void> => {
    for (const entry of entries) {
      const res = await window.git.stage.discard(activeRepo!.path, entry.path, entry.staged, entry.changeType)
      if (!res.ok) {
        pushToast('error', `Discard failed for ${entry.path}: ${res.stderr}`)
        return
      }
    }
    pushToast('info', `Discarded ${entries.length} file${entries.length === 1 ? '' : 's'}`)
    setMultiSelected(new Set())
    if (selectedFile && entries.some((e) => e.path === selectedFile.path)) setSelectedFile(null)
    await onRefresh()
  }, [activeRepo, pushToast, selectedFile, setSelectedFile, onRefresh])

  const handleFileClick = useCallback((
    e: React.MouseEvent,
    entry: FileEntry,
    sectionEntries: FileEntry[],
    section: 'unstaged' | 'staged'
  ): void => {
    const key = multiKey(entry.path, entry.staged)
    const metaOrCtrl = e.metaKey || e.ctrlKey

    if (e.shiftKey && lastClickedRef.current?.section === section) {
      // Range-select from anchor to here — does not change the anchor
      const sectionKeys = sectionEntries.map((f) => multiKey(f.path, f.staged))
      const anchorIdx = sectionKeys.indexOf(lastClickedRef.current.key)
      const curIdx = sectionKeys.indexOf(key)
      if (anchorIdx !== -1 && curIdx !== -1) {
        const [from, to] = [Math.min(anchorIdx, curIdx), Math.max(anchorIdx, curIdx)]
        setMultiSelected(new Set(sectionKeys.slice(from, to + 1)))
        return
      }
    }

    if (metaOrCtrl) {
      // Toggle this file in/out of the selection; update anchor but keep others.
      // If starting fresh (nothing multi-selected yet), seed the set with the
      // currently viewed file so it stays visually included in the selection.
      lastClickedRef.current = { key, section }
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.size === 0 && selectedFile) {
          next.add(multiKey(selectedFile.path, selectedFile.staged))
        }
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      return
    }

    // Plain click: select only this file, clear any existing multi-select, open diff
    lastClickedRef.current = { key, section }
    setMultiSelected(new Set())
    select(entry.path, entry.staged)
  }, [select])

  const openFileContextMenu = (e: React.MouseEvent, entry: FileEntry, allEntries: FileEntry[]): void => {
    e.preventDefault()
    e.stopPropagation()

    // If this file is part of a multi-selection (2+ files), show a bulk menu
    const key = multiKey(entry.path, entry.staged)
    if (multiSelected.size > 1 && multiSelected.has(key)) {
      const selected = allEntries.filter((f) => multiSelected.has(multiKey(f.path, f.staged)))
      const n = selected.length
      const isStaged = entry.staged
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: `${n} files selected`,
            disabled: true,
            onClick: () => {}
          },
          { type: 'separator' },
          isStaged
            ? {
                label: `Unstage ${n} file${n === 1 ? '' : 's'}`,
                onClick: () => {
                  void unstage(selected.map((f) => f.path))
                  setMultiSelected(new Set())
                }
              }
            : {
                label: `Stage ${n} file${n === 1 ? '' : 's'}`,
                onClick: () => {
                  void stage(selected.map((f) => f.path))
                  setMultiSelected(new Set())
                }
              },
          {
            label: `Discard ${n} file${n === 1 ? '' : 's'}`,
            danger: true,
            onClick: () => void discardMultiple(selected)
          },
          { type: 'separator' },
          {
            label: 'Clear selection',
            onClick: () => setMultiSelected(new Set())
          }
        ]
      })
      return
    }

    const fullPath = `${activeRepo.path}/${entry.path}`
    const items: MenuItem[] = [
      entry.staged
        ? { label: 'Unstage', onClick: () => unstage([entry.path]) }
        : { label: 'Stage', onClick: () => stage([entry.path]) },
      {
        label:
          entry.changeType === 'untracked'
            ? 'Delete file'
            : entry.staged
              ? 'Discard staged changes'
              : 'Discard changes',
        danger: true,
        onClick: () => discard(entry.path, entry.staged, entry.changeType)
      },
      { type: 'separator' },
      {
        label: 'Stash this file',
        disabled: entry.staged,
        onClick: () => {
          window.dispatchEvent(
            new CustomEvent('gitmetro:stash-files', { detail: { paths: [entry.path] } })
          )
        }
      },
      { type: 'separator' },
      {
        label: 'Open in editor',
        onClick: () => window.git.shell.openPath(fullPath)
      },
      {
        label: 'Show in Finder',
        onClick: () => window.git.shell.revealInFolder(fullPath)
      },
      { type: 'separator' },
      {
        label: 'Copy file path',
        onClick: () => navigator.clipboard.writeText(entry.path)
      },
      {
        label: 'Copy full path',
        onClick: () => navigator.clipboard.writeText(fullPath)
      },
      { type: 'separator' },
      {
        label: 'Add to .gitignore',
        onClick: async () => {
          const res = await window.git.gitignore.append(activeRepo.path, entry.path)
          if (res.ok) {
            useRepo.getState().pushToast('success', `Added ${entry.path} to .gitignore`)
            useRepo.getState().refreshSignal()
          } else {
            useRepo.getState().pushToast('error', `Failed: ${res.stderr}`)
          }
        }
      }
    ]
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Merge continue / abort helpers
  const mergeContinue = async (): Promise<void> => {
    if (!activeRepo) return
    const res = await window.git.conflict.mergeContinue(activeRepo.path)
    if (res.ok) { useRepo.getState().pushToast('success', 'Merge continued'); useRepo.getState().refreshSignal() }
    else useRepo.getState().pushToast('error', `Merge continue failed: ${res.stderr}`)
  }
  const mergeAbort = async (): Promise<void> => {
    if (!activeRepo) return
    const res = await window.git.conflict.mergeAbort(activeRepo.path)
    if (res.ok) { useRepo.getState().pushToast('info', 'Merge aborted'); useRepo.getState().refreshSignal() }
    else useRepo.getState().pushToast('error', `Merge abort failed: ${res.stderr}`)
  }

  if (conflictFile) {
    return (
      <div className="flex-1 min-h-0">
        <ConflictEditor
          filePath={conflictFile}
          onClose={() => setConflictFile(null)}
          onResolved={() => setConflictFile(null)}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Path / Tree toggle ──────────────────────────────────────── */}
      <div className="h-7 px-2 flex items-center justify-end gap-0.5 bg-bg-subtle border-b border-line shrink-0">
        <button
          onClick={() => setView('path')}
          title="Flat path list"
          className={
            'flex items-center gap-1 px-2 py-0.5 rounded text-xs ' +
            (viewMode === 'path'
              ? 'bg-bg-panel text-text border border-line'
              : 'text-muted hover:text-text')
          }
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="0" y="1.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="0" y="5.25" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="0" y="9" width="12" height="1.5" rx="0.75" fill="currentColor"/>
          </svg>
          Path
        </button>
        <button
          onClick={() => setView('tree')}
          title="Folder tree"
          className={
            'flex items-center gap-1 px-2 py-0.5 rounded text-xs ' +
            (viewMode === 'tree'
              ? 'bg-bg-panel text-text border border-line'
              : 'text-muted hover:text-text')
          }
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="0" y="1" width="5" height="4" rx="1" fill="currentColor" opacity="0.8"/>
            <rect x="3" y="7" width="9" height="3" rx="1" fill="currentColor" opacity="0.5"/>
            <rect x="1.5" y="5" width="1" height="2" fill="currentColor" opacity="0.6"/>
            <rect x="1.5" y="5" width="6" height="1" fill="currentColor" opacity="0.6"/>
          </svg>
          Tree
        </button>
      </div>

      {conflicted.length > 0 && (
        <Section
          title={`Conflicts (${conflicted.length})`}
          accent="danger"
          headerExtra={
            <div className="flex gap-1">
              <button
                onClick={() => void mergeContinue()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30 hover:bg-success/25"
                title="Continue merge (all conflicts must be resolved)"
              >Continue</button>
              <button
                onClick={() => void mergeAbort()}
                className="text-[10px] px-1.5 py-0.5 rounded bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25"
                title="Abort merge"
              >Abort</button>
            </div>
          }
        >
          {conflicted.map((f) => (
            <FileRow
              key={`c-${f.path}`}
              entry={f}
              selected={isSelected(f.path, false)}
              multiSelected={false}
              onClick={() => setConflictFile(f.path)}
              actionLabel="Stage"
              onAction={() => stage([f.path])}
              confirming={pendingDiscard === discardKey(f.path, false)}
              onDiscard={() => discard(f.path, false, f.changeType)}
              onContextMenu={(e) => openFileContextMenu(e, f, conflicted)}
            />
          ))}
        </Section>
      )}

      {(() => {
        const selectedUnstaged = unstagedAll.filter((f) => multiSelected.has(multiKey(f.path, false)))
        return (
          <Section
            title={`Changes (${unstagedAll.length})`}
            actionLabel={unstagedAll.length > 0 ? 'Stage all' : undefined}
            onAction={
              unstagedAll.length > 0
                ? () => stage(unstagedAll.map((f) => f.path))
                : undefined
            }
            headerExtra={
              selectedUnstaged.length > 1 ? (
                <button
                  onClick={() => {
                    void stage(selectedUnstaged.map((f) => f.path))
                    setMultiSelected(new Set())
                  }}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Stage selected ({selectedUnstaged.length})
                </button>
              ) : undefined
            }
          >
        {unstagedAll.length === 0 ? (
          <Empty text="Working tree clean" />
        ) : viewMode === 'tree' ? (
          <TreeView
            nodes={buildTree(unstagedAll)}
            isSelected={(e) => isSelected(e.path, false)}
            onClick={(e) => select(e.path, false)}
            actionLabel="Stage"
            onAction={(e) => stage([e.path])}
            isConfirming={(e) => pendingDiscard === discardKey(e.path, false)}
            onDiscard={(e) => discard(e.path, false, e.changeType)}
            onContextMenu={(ev, e) => openFileContextMenu(ev, e, unstagedAll)}
          />
        ) : (
          unstagedAll.map((f) => (
            <FileRow
              key={`u-${f.path}`}
              entry={f}
              selected={isSelected(f.path, false)}
              multiSelected={multiSelected.has(multiKey(f.path, false))}
              onClick={(e) => handleFileClick(e, f, unstagedAll, 'unstaged')}
              actionLabel="Stage"
              onAction={() => stage([f.path])}
              confirming={pendingDiscard === discardKey(f.path, false)}
              onDiscard={() => discard(f.path, false, f.changeType)}
              onContextMenu={(e) => openFileContextMenu(e, f, unstagedAll)}
            />
          ))
        )}
          </Section>
        )
      })()}

      {(() => {
        const selectedStaged = stagedAll.filter((f) => multiSelected.has(multiKey(f.path, true)))
        return (
          <Section
            title={`Staged (${stagedAll.length})`}
            actionLabel={stagedAll.length > 0 ? 'Unstage all' : undefined}
            onAction={
              stagedAll.length > 0
                ? () => unstage(stagedAll.map((f) => f.path))
                : undefined
            }
            headerExtra={
              selectedStaged.length > 1 ? (
                <button
                  onClick={() => {
                    void unstage(selectedStaged.map((f) => f.path))
                    setMultiSelected(new Set())
                  }}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Unstage selected ({selectedStaged.length})
                </button>
              ) : undefined
            }
          >
        {stagedAll.length === 0 ? (
          <Empty text="No staged changes" />
        ) : viewMode === 'tree' ? (
          <TreeView
            nodes={buildTree(stagedAll)}
            isSelected={(e) => isSelected(e.path, true)}
            onClick={(e) => select(e.path, true)}
            actionLabel="Unstage"
            onAction={(e) => unstage([e.path])}
            isConfirming={(e) => pendingDiscard === discardKey(e.path, true)}
            onDiscard={(e) => discard(e.path, true, e.changeType)}
            onContextMenu={(ev, e) => openFileContextMenu(ev, e, stagedAll)}
          />
        ) : (
          stagedAll.map((f) => (
            <FileRow
              key={`s-${f.path}`}
              entry={f}
              selected={isSelected(f.path, true)}
              multiSelected={multiSelected.has(multiKey(f.path, true))}
              onClick={(e) => handleFileClick(e, f, stagedAll, 'staged')}
              actionLabel="Unstage"
              onAction={() => unstage([f.path])}
              confirming={pendingDiscard === discardKey(f.path, true)}
              onDiscard={() => discard(f.path, true, f.changeType)}
              onContextMenu={(e) => openFileContextMenu(e, f, stagedAll)}
            />
          ))
        )}
          </Section>
        )
      })()}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  accent?: 'danger'
  actionLabel?: string
  onAction?: () => void
  headerExtra?: React.ReactNode
  children: React.ReactNode
}

function Section({ title, accent, actionLabel, onAction, headerExtra, children }: SectionProps): JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col border-b border-line last:border-b-0">
      <div className="h-7 px-3 flex items-center justify-between bg-bg-subtle border-b border-line">
        <span
          className={
            'text-xs uppercase tracking-wide ' +
            (accent === 'danger' ? 'text-danger' : 'text-muted')
          }
        >
          {title}
        </span>
        <div className="flex items-center gap-2">
          {headerExtra}
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="text-xs text-accent hover:text-accent-hover"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

interface FileRowProps {
  entry: FileEntry
  selected: boolean
  multiSelected: boolean
  onClick: (e: React.MouseEvent) => void
  actionLabel: string
  onAction: () => void
  confirming: boolean
  onDiscard: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function FileRow({
  entry,
  selected,
  multiSelected,
  onClick,
  actionLabel,
  onAction,
  confirming,
  onDiscard,
  onContextMenu
}: FileRowProps): JSX.Element {
  const badge = changeBadge(entry)
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={
        'group flex items-center px-3 py-1 text-sm cursor-pointer ' +
        (multiSelected ? 'bg-accent/30 ring-1 ring-inset ring-accent/50' : selected ? 'bg-accent/20' : 'hover:bg-bg-panel')
      }
      title={entry.path}
    >
      <span className={`font-mono w-4 text-xs ${badge.cls}`}>{badge.label}</span>
      <span className="ml-2 flex-1 truncate">{entry.path}</span>

      {/* Stage / Unstage action */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        className="ml-1 opacity-0 group-hover:opacity-100 text-xs text-accent hover:text-accent-hover"
      >
        {actionLabel}
      </button>

      {/* Discard button — two-click confirm */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDiscard()
        }}
        className={
          'ml-1 text-xs ' +
          (confirming
            ? 'opacity-100 text-danger font-semibold animate-pulse'
            : 'opacity-0 group-hover:opacity-100 text-muted hover:text-danger')
        }
        title={
          confirming
            ? 'Click again to permanently discard changes'
            : entry.changeType === 'untracked'
              ? 'Delete file'
              : entry.staged
                ? 'Discard staged changes (restores to HEAD)'
                : 'Discard changes (restores to HEAD)'
        }
      >
        {confirming ? 'Confirm?' : '✕'}
      </button>
    </div>
  )
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="px-3 py-2 text-xs text-muted italic">{text}</div>
}

// ── Tree view ─────────────────────────────────────────────────────────────────

interface TreeViewProps {
  nodes: TreeNode[]
  isSelected: (e: FileEntry) => boolean
  onClick: (e: FileEntry) => void
  actionLabel: string
  onAction: (e: FileEntry) => void
  isConfirming: (e: FileEntry) => boolean
  onDiscard: (e: FileEntry) => void
  onContextMenu: (ev: React.MouseEvent, e: FileEntry) => void
}

function TreeView(props: TreeViewProps): JSX.Element {
  // All dirs start expanded
  const initialExpanded = (): Set<string> => {
    const s = new Set<string>()
    const collect = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'dir') { s.add(n.path); collect(n.children) }
      }
    }
    collect(props.nodes)
    return s
  }
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)
  const prevNodesRef = useRef(props.nodes)

  // Re-expand new dirs when nodes change (e.g. new files appear)
  useEffect(() => {
    if (prevNodesRef.current === props.nodes) return
    prevNodesRef.current = props.nodes
    setExpanded((prev) => {
      const next = new Set(prev)
      const collect = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
          if (n.kind === 'dir') { next.add(n.path); collect(n.children) }
        }
      }
      collect(props.nodes)
      return next
    })
  }, [props.nodes])

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNodes = (nodes: TreeNode[], depth: number): JSX.Element[] => {
    const out: JSX.Element[] = []
    for (const node of nodes) {
      if (node.kind === 'dir') {
        const open = expanded.has(node.path)
        const fileCount = countFiles(node)
        out.push(
          <div
            key={`dir-${node.path}`}
            onClick={() => toggle(node.path)}
            className="flex items-center px-2 py-0.5 cursor-pointer hover:bg-bg-panel select-none"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span className="text-muted mr-1 text-[10px] w-3">{open ? '▾' : '▸'}</span>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="mr-1.5 shrink-0">
              <path
                d="M1 3.5C1 2.67 1.67 2 2.5 2H5l1 1.5h4.5C11.33 3.5 12 4.17 12 5v5c0 .83-.67 1.5-1.5 1.5h-8C1.67 11.5 1 10.83 1 10V3.5z"
                fill="currentColor"
                className="text-accent opacity-60"
              />
            </svg>
            <span className="text-xs text-text truncate flex-1">{node.name}</span>
            <span className="text-[10px] text-muted ml-1 shrink-0">{fileCount}</span>
          </div>
        )
        if (open) {
          out.push(...renderNodes(node.children, depth + 1))
        }
      } else {
        const { entry } = node
        const badge = changeBadge(entry)
        out.push(
          <div
            key={`file-${entry.path}`}
            onClick={() => props.onClick(entry)}
            onContextMenu={(ev) => props.onContextMenu(ev, entry)}
            title={entry.path}
            className={
              'group flex items-center py-0.5 text-sm cursor-pointer ' +
              (props.isSelected(entry) ? 'bg-accent/20' : 'hover:bg-bg-panel')
            }
            style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px' }}
          >
            <span className="w-3 mr-1 shrink-0" />
            <span className={`font-mono w-4 text-xs shrink-0 ${badge.cls}`}>{badge.label}</span>
            <span className="ml-1.5 flex-1 truncate text-xs">{node.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); props.onAction(entry) }}
              className="ml-1 opacity-0 group-hover:opacity-100 text-xs text-accent hover:text-accent-hover shrink-0"
            >
              {props.actionLabel}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); props.onDiscard(entry) }}
              className={
                'ml-1 text-xs shrink-0 ' +
                (props.isConfirming(entry)
                  ? 'opacity-100 text-danger font-semibold animate-pulse'
                  : 'opacity-0 group-hover:opacity-100 text-muted hover:text-danger')
              }
              title={
                props.isConfirming(entry)
                  ? 'Click again to permanently discard changes'
                  : entry.changeType === 'untracked'
                    ? 'Delete file'
                    : entry.staged
                      ? 'Discard staged changes (restores to HEAD)'
                      : 'Discard changes (restores to HEAD)'
              }
            >
              {props.isConfirming(entry) ? 'Confirm?' : '✕'}
            </button>
          </div>
        )
      }
    }
    return out
  }

  return <>{renderNodes(props.nodes, 0)}</>
}

function countFiles(node: DirNode): number {
  let n = 0
  for (const child of node.children) {
    if (child.kind === 'file') n++
    else n += countFiles(child)
  }
  return n
}
