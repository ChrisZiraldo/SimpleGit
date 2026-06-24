import { useEffect, useState } from 'react'
import { GripVertical, Trash2, X, Play, StopCircle } from 'lucide-react'
import type { RebaseAction } from '@shared/types'
import { useRepo } from '../store/useRepo'

interface Props {
  onClose: () => void
}

const ACTION_COLORS: Record<RebaseAction, string> = {
  pick: '#3b82f6',
  squash: '#f59e0b',
  fixup: '#f97316',
  drop: '#ef4444'
}

const ACTION_LABELS: Record<RebaseAction, string> = {
  pick: 'Pick',
  squash: 'Squash',
  fixup: 'Fixup',
  drop: 'Drop'
}

export function RebasePanel({ onClose }: Props): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const rebasePlan = useRepo((s) => s.rebasePlan)
  const setRebasePlan = useRepo((s) => s.setRebasePlan)
  const rebaseInProgress = useRepo((s) => s.rebaseInProgress)
  const setRebaseInProgress = useRepo((s) => s.setRebaseInProgress)
  const pushToast = useRepo((s) => s.pushToast)
  const refreshSignal = useRepo((s) => s.refreshSignal)
  const pushUndoEntry = useRepo((s) => s.pushUndoEntry)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [executing, setExecuting] = useState(false)

  // Check for in-progress rebase on mount
  useEffect(() => {
    if (!activeRepo) return
    void (async () => {
      const res = await window.git.rebase.status(activeRepo.path)
      if (res.ok) setRebaseInProgress(res.data.inProgress)
    })()
  }, [activeRepo])

  const updateAction = (index: number, action: RebaseAction): void => {
    setRebasePlan(rebasePlan.map((e, i) => (i === index ? { ...e, action } : e)))
  }

  const handleDragStart = (index: number): void => setDragIndex(index)
  const handleDragOver = (e: React.DragEvent, index: number): void => {
    e.preventDefault()
    setDragOverIndex(index)
  }
  const handleDrop = (targetIndex: number): void => {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); setDragOverIndex(null); return }
    const newPlan = [...rebasePlan]
    const [moved] = newPlan.splice(dragIndex, 1)
    newPlan.splice(targetIndex, 0, moved)
    setRebasePlan(newPlan)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const executeRebase = async (): Promise<void> => {
    if (!activeRepo || !rebasePlan.length) return
    // The onto SHA is the parent of the oldest pick in the plan
    // We need the parent of the last commit in the plan (the oldest one)
    const oldestSha = rebasePlan[rebasePlan.length - 1].sha
    // Capture undo point
    const shaRes = await window.git.gitUndo.headSha(activeRepo.path)
    if (shaRes.ok) pushUndoEntry({ label: 'Interactive rebase', beforeSha: shaRes.data })

    setExecuting(true)
    // Get parent of oldest commit as the "onto" base
    const parentRes = await window.git.commitInspect.show(activeRepo.path, oldestSha)
    if (!parentRes.ok || !parentRes.data.parents.length) {
      setExecuting(false)
      pushToast('error', 'Cannot rebase: could not determine base commit')
      return
    }
    const ontoSha = parentRes.data.parents[0]
    const res = await window.git.rebase.start(activeRepo.path, ontoSha, rebasePlan)
    setExecuting(false)
    if (res.ok) {
      pushToast('success', 'Rebase completed')
      setRebasePlan([])
      setRebaseInProgress(false)
      refreshSignal()
      onClose()
    } else if (res.stderr.includes('conflict') || res.stderr.includes('CONFLICT')) {
      pushToast('error', 'Rebase paused due to conflicts — resolve them then continue')
      setRebaseInProgress(true)
    } else {
      pushToast('error', `Rebase failed: ${res.stderr}`)
    }
  }

  const continueRebase = async (): Promise<void> => {
    if (!activeRepo) return
    setExecuting(true)
    const res = await window.git.rebase.continue(activeRepo.path)
    setExecuting(false)
    if (res.ok) {
      pushToast('success', 'Rebase continued')
      setRebaseInProgress(false)
      setRebasePlan([])
      refreshSignal()
      onClose()
    } else {
      pushToast('error', `Continue failed: ${res.stderr}`)
    }
  }

  const abortRebase = async (): Promise<void> => {
    if (!activeRepo) return
    const res = await window.git.rebase.abort(activeRepo.path)
    if (res.ok) {
      pushToast('info', 'Rebase aborted')
      setRebaseInProgress(false)
      setRebasePlan([])
      refreshSignal()
      onClose()
    } else {
      pushToast('error', `Abort failed: ${res.stderr}`)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', right: 0, top: 40, bottom: 0, width: 380,
        background: '#0b0e14', borderLeft: '1px solid #2a2f3b',
        display: 'flex', flexDirection: 'column', zIndex: 300
      }}
    >
      {/* Header */}
      <div style={{ height: 44, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2a2f3b', background: '#161b22' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>Interactive Rebase</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      {rebaseInProgress ? (
        /* In-progress state */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ fontSize: 13, color: '#f59e0b', textAlign: 'center', lineHeight: 1.6 }}>
            Rebase in progress.<br />
            Resolve any conflicts in the Status panel, then continue.
          </div>
          <button
            disabled={executing}
            onClick={() => void continueRebase()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#238636', border: '1px solid #2ea043', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer' }}
          >
            <Play size={14} /> {executing ? 'Continuing…' : 'Continue Rebase'}
          </button>
          <button
            disabled={executing}
            onClick={() => void abortRebase()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#21262d', border: '1px solid #2a2f3b', borderRadius: 6, color: '#ef4444', fontSize: 13, cursor: 'pointer' }}
          >
            <StopCircle size={14} /> Abort Rebase
          </button>
        </div>
      ) : rebasePlan.length === 0 ? (
        /* Empty state — right-click a station to start */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
          <span style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.6 }}>
            Right-click a branch station on the map and choose
            <br />
            <strong style={{ color: '#c9d1d9' }}>"Start rebase from here…"</strong>
            <br />
            to build a rebase plan.
          </span>
        </div>
      ) : (
        <>
          {/* Instructions */}
          <div style={{ padding: '8px 16px', fontSize: 11, color: '#8b949e', borderBottom: '1px solid #2a2f3b' }}>
            Drag to reorder · Change actions · Drop commits you want to remove
          </div>

          {/* Plan list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rebasePlan.map((entry, i) => (
              <div
                key={entry.sha}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', borderBottom: '1px solid #21262d',
                  background: dragOverIndex === i ? '#1a2027' : 'transparent',
                  opacity: dragIndex === i ? 0.4 : 1,
                  cursor: 'grab'
                }}
              >
                <GripVertical size={12} color="#484f58" style={{ flexShrink: 0 }} />
                <select
                  value={entry.action}
                  onChange={(e) => updateAction(i, e.target.value as RebaseAction)}
                  style={{
                    background: `${ACTION_COLORS[entry.action]}22`,
                    border: `1px solid ${ACTION_COLORS[entry.action]}66`,
                    borderRadius: 4, padding: '2px 4px', fontSize: 11,
                    color: ACTION_COLORS[entry.action], cursor: 'pointer', outline: 'none'
                  }}
                >
                  {(Object.keys(ACTION_LABELS) as RebaseAction[]).map((a) => (
                    <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                  ))}
                </select>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#8b949e', flexShrink: 0 }}>
                  {entry.sha.slice(0, 7)}
                </span>
                <span style={{ flex: 1, fontSize: 11, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.subject ?? ''}
                </span>
                <button
                  onClick={() => updateAction(i, entry.action === 'drop' ? 'pick' : 'drop')}
                  style={{ background: 'none', border: 'none', color: entry.action === 'drop' ? '#ef4444' : '#484f58', cursor: 'pointer', padding: 2 }}
                  title={entry.action === 'drop' ? 'Restore commit' : 'Drop commit'}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid #2a2f3b', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#161b22' }}>
            <button
              onClick={() => { setRebasePlan([]); onClose() }}
              style={{ padding: '6px 12px', background: '#21262d', border: '1px solid #2a2f3b', borderRadius: 6, color: '#8b949e', fontSize: 12, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              disabled={executing || rebasePlan.every((e) => e.action === 'drop')}
              onClick={() => void executeRebase()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', background: '#1f6feb', border: '1px solid #388bfd',
                borderRadius: 6, color: '#fff', fontSize: 12, cursor: 'pointer',
                opacity: executing || rebasePlan.every((e) => e.action === 'drop') ? 0.5 : 1
              }}
            >
              <Play size={12} /> {executing ? 'Running…' : 'Run Rebase'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
