import { useEffect, useState } from 'react'
import { useRepo } from './store/useRepo'
import { useGitStatus } from './hooks/useGitStatus'
import { useCiStatus } from './hooks/useCiStatus'
import { RefsSidebar } from './components/RefsSidebar'
import { Toast } from './components/Toast'
import { EmptyState } from './components/EmptyState'
import { StatusPanel } from './components/StatusPanel'
import { CommitBox } from './components/CommitBox'
import { DiffViewer } from './components/DiffViewer'
import { TopBar } from './components/TopBar'
import { MetroMap } from './components/metro/MetroMap'
import { StationDetailsPanel } from './components/StationDetailsPanel'
import { PullRequestsView } from './components/PullRequestsView'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { useHotkeys } from './hooks/useHotkeys'

export function App(): JSX.Element {
  const activeRepo = useRepo((s) => s.activeRepo)
  const setActiveRepo = useRepo((s) => s.setActiveRepo)
  const setRecents = useRepo((s) => s.setRecents)
  const pushToast = useRepo((s) => s.pushToast)
  const refreshSignal = useRepo((s) => s.refreshSignal)
  const selectedFile = useRepo((s) => s.selectedFile)
  const setSelectedFile = useRepo((s) => s.setSelectedFile)
  const selectedCommit = useRepo((s) => s.selectedCommit)
  const stashView = useRepo((s) => s.stashView)
  const setStashView = useRepo((s) => s.setStashView)
  const metroViewTab = useRepo((s) => s.metroViewTab)
  const setBusy = useRepo((s) => s.setBusy)
  useGitStatus()
  useCiStatus()
  useHotkeys({
    onFetch: () => {
      if (!activeRepo) return
      void (async () => {
        setBusy(true)
        try {
          const res = await window.git.remote.fetch(activeRepo.path)
          if (res.ok) { pushToast('success', 'Fetched'); refreshSignal() }
          else pushToast('error', `Fetch failed: ${res.stderr}`)
        } finally {
          setBusy(false)
        }
      })()
    },
    onPush: () => {
      if (!activeRepo) return
      void (async () => {
        setBusy(true)
        try {
          const res = await window.git.remote.push(activeRepo.path, {})
          if (res.ok) { pushToast('success', 'Pushed'); refreshSignal() }
          else pushToast('error', `Push failed: ${res.stderr}`)
        } finally {
          setBusy(false)
        }
      })()
    },
    onPull: () => {
      if (!activeRepo) return
      void (async () => {
        setBusy(true)
        try {
          const res = await window.git.remote.pull(activeRepo.path, {})
          if (res.ok) { pushToast('success', 'Pulled'); refreshSignal() }
          else pushToast('error', `Pull failed: ${res.stderr}`)
        } finally {
          setBusy(false)
        }
      })()
    }
  })

  const [dryRun, setDryRun] = useState<{ active: boolean; logPath: string } | null>(null)
  useEffect(() => {
    void window.git.dryRun.status().then(setDryRun)
  }, [])

  useEffect(() => {
    void (async () => {
      const [recentsRes, lastRes] = await Promise.all([
        window.git.repo.recents(),
        window.git.repo.getLast()
      ])
      if (recentsRes.ok) setRecents(recentsRes.data)
      else pushToast('error', recentsRes.stderr)

      if (lastRes.ok && lastRes.data) {
        const openRes = await window.git.repo.open(lastRes.data)
        if (openRes.ok) {
          setActiveRepo(openRes.data)
          if (recentsRes.ok) {
            const fresh = await window.git.repo.recents()
            if (fresh.ok) setRecents(fresh.data)
          }
        }
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const unsubOpen = window.git.appMenu.onOpenRepo(async (path) => {
      if (path === '__clear_recents__') return
      const res = await window.git.repo.open(path)
      if (res.ok) {
        setActiveRepo(res.data)
        const fresh = await window.git.repo.recents()
        if (fresh.ok) setRecents(fresh.data)
      } else {
        pushToast('error', res.stderr)
      }
    })
    const unsubClose = window.git.appMenu.onCloseRepo(() => {
      setActiveRepo(null)
    })
    return () => {
      unsubOpen()
      unsubClose()
    }
  }, [setActiveRepo, setRecents, pushToast])

  const refresh = async (): Promise<void> => {
    refreshSignal()
  }

  const dryRunBanner = dryRun?.active ? (
    <div className="w-full px-3 py-1 bg-warn text-black text-xs font-semibold flex items-center gap-2 z-50 shrink-0">
      <span>⚠ DRY-RUN MODE — git write commands are logged, not executed.</span>
      <span className="font-mono font-normal truncate opacity-70">{dryRun.logPath}</span>
    </div>
  ) : null

  // The diff overlay shows when either a working-tree file is selected OR a
  // file inside a stash is being inspected (RefsSidebar sets stashView).
  const showDiffOverlay = !!selectedFile || !!stashView
  const closeDiff = (): void => {
    if (selectedFile) setSelectedFile(null)
    if (stashView) setStashView(null)
  }

  return (
    <div className="h-full w-full flex flex-col bg-bg text-text">
      {dryRunBanner}
      <TopBar />
      <div className="flex-1 min-h-0 flex flex-col">
        {activeRepo ? (
          <div className="flex-1 min-h-0 flex">
            <RefsSidebar />

            {/* Center: metro map with diff overlay */}
            <div className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
              {metroViewTab === 'history' ? (
                <MetroMap />
              ) : metroViewTab === 'prs' ? (
                <PullRequestsView />
              ) : (
                <TabPlaceholder tab={metroViewTab} />
              )}
              {showDiffOverlay && (
                <div className="absolute inset-0 z-20 bg-bg flex flex-col">
                  <DiffViewer onClose={closeDiff} />
                </div>
              )}
            </div>

            {/* Right context panel */}
            <div className="w-[340px] min-w-[300px] border-l border-line flex flex-col bg-bg shrink-0">
              {selectedCommit && !stashView ? (
                <StationDetailsPanel />
              ) : (
                <>
                  <StatusPanel onRefresh={refresh} />
                  <CommitBox onRefresh={refresh} />
                </>
              )}
            </div>
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
      <Toast />
      <ShortcutsOverlay />
    </div>
  )
}

function TabPlaceholder({ tab }: { tab: string }): JSX.Element {
  const titles: Record<string, { title: string; body: string }> = {
    insights: {
      title: 'Insights',
      body: 'CI failure heatmap, stale branches, and risk signals. Coming soon.'
    },
    authors: {
      title: 'Authors',
      body: 'Colorize the map by commit author. Coming soon.'
    }
  }
  const info = titles[tab] ?? { title: tab, body: 'Coming soon.' }
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
      <span className="text-xs uppercase tracking-wider text-muted">{tab}</span>
      <h2 className="text-lg font-semibold text-text">{info.title}</h2>
      <p className="text-sm text-muted max-w-sm">{info.body}</p>
    </div>
  )
}
