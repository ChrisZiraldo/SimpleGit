import type { RebasePlanEntry, RebaseStatus, Result } from '@shared/types'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit, runGitVoid } from './runner'

/**
 * Starts a scripted interactive rebase.
 * We write a GIT_SEQUENCE_EDITOR shell script that replaces git's todo list
 * with the caller-supplied plan, then invoke `git rebase -i <ontoSha>`.
 */
export async function startRebase(
  cwd: string,
  ontoSha: string,
  plan: RebasePlanEntry[]
): Promise<Result<true>> {
  if (!ontoSha) return { ok: false, code: 1, stderr: 'Base commit SHA required' }
  if (!plan.length) return { ok: false, code: 1, stderr: 'Rebase plan is empty' }

  // Build the todo list content
  const todoLines = plan
    .map((e) => `${e.action} ${e.sha}${e.subject ? ' ' + e.subject : ''}`)
    .join('\n')

  // Write a temporary sequence-editor script that replaces the todo file
  const scriptDir = join(tmpdir(), 'simplegit-rebase')
  if (!existsSync(scriptDir)) mkdirSync(scriptDir, { recursive: true })
  const scriptPath = join(scriptDir, 'sequence-editor.sh')
  const todoContent = todoLines
  // The script receives the path to the todo file as $1 and overwrites it
  const scriptContent = `#!/bin/sh\ncat > "$1" << 'SIMPLEGIT_TODO'\n${todoContent}\nSIMPLEGIT_TODO\n`
  writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  return runGitVoid(['rebase', '--no-gpg-sign', '-i', ontoSha], {
    cwd,
    env: {
      ...process.env,
      GIT_SEQUENCE_EDITOR: scriptPath,
      GIT_EDITOR: 'true' // suppress any editor for reword (message comes from plan)
    }
  })
}

export async function getRebaseStatus(cwd: string): Promise<Result<RebaseStatus>> {
  const rebaseDir = join(cwd, '.git', 'rebase-merge')
  const rebaseDirApply = join(cwd, '.git', 'rebase-apply')
  const inProgress = existsSync(rebaseDir) || existsSync(rebaseDirApply)

  if (!inProgress) {
    return { ok: true, data: { inProgress: false, head: null, onto: null } }
  }

  const headRes = await runGit(['rev-parse', 'HEAD'], { cwd })
  const ontoRes = await runGit(
    ['rev-parse', existsSync(rebaseDir) ? '.git/rebase-merge/onto' : '.git/rebase-apply/onto'],
    { cwd }
  )

  return {
    ok: true,
    data: {
      inProgress: true,
      head: headRes.ok ? headRes.data.trim() : null,
      onto: ontoRes.ok ? ontoRes.data.trim() : null
    }
  }
}

export async function rebaseContinue(cwd: string): Promise<Result<true>> {
  return runGitVoid(['rebase', '--continue', '--no-gpg-sign'], {
    cwd,
    env: { ...process.env, GIT_EDITOR: 'true' }
  })
}

export async function rebaseAbort(cwd: string): Promise<Result<true>> {
  return runGitVoid(['rebase', '--abort'], { cwd })
}

/** Simple non-interactive rebase of the current branch onto another branch. */
export async function rebaseOnto(cwd: string, branch: string): Promise<Result<true>> {
  return runGitVoid(['rebase', '--no-gpg-sign', branch], { cwd })
}
