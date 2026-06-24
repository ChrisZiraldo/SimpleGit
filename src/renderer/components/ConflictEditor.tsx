import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { ConflictVersions } from '@shared/types'
import { useRepo } from '../store/useRepo'

interface Props {
  filePath: string
  onClose: () => void
  onResolved: () => void
}

export function ConflictEditor({ filePath, onClose, onResolved }: Props): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const pushToast = useRepo((s) => s.pushToast)
  const refreshSignal = useRepo((s) => s.refreshSignal)
  const [versions, setVersions] = useState<ConflictVersions | null>(null)
  const [loading, setLoading] = useState(true)
  const [merged, setMerged] = useState('')
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    if (!activeRepo) return
    setLoading(true)
    void (async () => {
      const res = await window.git.conflict.versions(activeRepo.path, filePath)
      setLoading(false)
      if (res.ok) {
        setVersions(res.data)
        // Start with "ours" as the default merged content
        setMerged(res.data.ours)
      } else {
        pushToast('error', `Failed to load conflict: ${res.stderr}`)
      }
    })()
  }, [activeRepo, filePath])

  const resolveWithSide = async (side: 'ours' | 'theirs'): Promise<void> => {
    if (!activeRepo) return
    setResolving(true)
    const res = await window.git.conflict.useSide(activeRepo.path, filePath, side)
    setResolving(false)
    if (res.ok) {
      pushToast('success', `Resolved using ${side}`)
      refreshSignal()
      onResolved()
    } else {
      pushToast('error', `Failed: ${res.stderr}`)
    }
  }

  const resolveWithContent = async (): Promise<void> => {
    if (!activeRepo) return
    setResolving(true)
    const res = await window.git.conflict.resolve(activeRepo.path, filePath, merged)
    setResolving(false)
    if (res.ok) {
      pushToast('success', `Resolved: ${filePath}`)
      refreshSignal()
      onResolved()
    } else {
      pushToast('error', `Failed: ${res.stderr}`)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        Loading conflict…
      </div>
    )
  }

  if (!versions) return <></>

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-line shrink-0 bg-bg-subtle">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-danger" />
          <span className="text-sm font-medium text-text truncate max-w-xs" title={filePath}>{filePath}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-line text-muted hover:text-text">
          <X size={14} />
        </button>
      </div>

      {/* Quick resolve buttons */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 bg-bg-subtle">
        <span className="text-xs text-muted">Quick resolve:</span>
        <button
          disabled={resolving}
          onClick={() => void resolveWithSide('ours')}
          className="px-2 py-1 text-xs rounded border border-line hover:bg-line text-text disabled:opacity-40"
        >
          Use Ours
        </button>
        <button
          disabled={resolving}
          onClick={() => void resolveWithSide('theirs')}
          className="px-2 py-1 text-xs rounded border border-line hover:bg-line text-text disabled:opacity-40"
        >
          Use Theirs
        </button>
        <button
          disabled={resolving}
          onClick={() => {
            setMerged(versions.ours + '\n' + versions.theirs)
          }}
          className="px-2 py-1 text-xs rounded border border-line hover:bg-line text-text disabled:opacity-40"
        >
          Use Both
        </button>
        <div className="flex-1" />
        <button
          disabled={resolving}
          onClick={() => void resolveWithContent()}
          className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-success/15 border border-success/40 text-success hover:bg-success/25 disabled:opacity-40"
        >
          <CheckCircle2 size={12} />
          {resolving ? 'Resolving…' : 'Mark Resolved'}
        </button>
      </div>

      {/* 3-column view */}
      <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">
        {/* Ours */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-line">
          <div className="px-3 py-1.5 text-xs font-semibold text-text bg-bg-subtle border-b border-line flex items-center justify-between">
            <span>Ours (HEAD)</span>
            <button
              className="text-[10px] text-accent hover:text-accent-hover"
              onClick={() => setMerged(versions.ours)}
            >Use →</button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-text leading-5 bg-bg whitespace-pre-wrap break-all">
            {versions.ours || <span className="text-muted italic">empty</span>}
          </pre>
        </div>

        {/* Merged (editable) */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-line">
          <div className="px-3 py-1.5 text-xs font-semibold text-text bg-bg-subtle border-b border-line">
            Merged (edit here)
          </div>
          <textarea
            value={merged}
            onChange={(e) => setMerged(e.target.value)}
            className="flex-1 w-full p-3 text-xs font-mono text-text leading-5 bg-bg resize-none focus:outline-none"
            spellCheck={false}
          />
        </div>

        {/* Theirs */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-3 py-1.5 text-xs font-semibold text-text bg-bg-subtle border-b border-line flex items-center justify-between">
            <span>Theirs (incoming)</span>
            <button
              className="text-[10px] text-accent hover:text-accent-hover"
              onClick={() => setMerged(versions.theirs)}
            >← Use</button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-text leading-5 bg-bg whitespace-pre-wrap break-all">
            {versions.theirs || <span className="text-muted italic">empty</span>}
          </pre>
        </div>
      </div>
    </div>
  )
}
