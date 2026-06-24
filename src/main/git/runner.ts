import { execFile, spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { Result } from '@shared/types'

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 32 * 1024 * 1024

// ---------------------------------------------------------------------------
// Dry-run mode
//
// Set SIMPLEGIT_DRY_RUN=1 in the environment before launching the app.
// Every git invocation is logged to DRY_RUN_LOG (default: workspace/dry-run.log)
// instead of being executed.  Read-only commands (log, status, diff, for-each-ref
// branch --list …) are still executed so the UI is populated with real data;
// only write commands are intercepted.
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.SIMPLEGIT_DRY_RUN === '1'
const DRY_RUN_LOG = process.env.SIMPLEGIT_DRY_RUN_LOG
  ?? join(process.cwd(), 'dry-run.log')

// Read-only git sub-commands — executed even in dry-run mode.
const READ_ONLY_CMDS = new Set([
  'log', 'status', 'diff', 'show', 'for-each-ref',
  'rev-parse', 'ls-files', 'cat-file', 'describe'
])

function isReadOnly(args: string[]): boolean {
  const sub = args[0]
  if (!sub) return true
  if (READ_ONLY_CMDS.has(sub)) return true
  // `stash list` / `stash show` are reads; `stash push/pop/apply/drop` are writes
  if (sub === 'stash') {
    const op = args[1] ?? ''
    return op === 'list' || op === 'show'
  }
  // `branch` with no args or read-only flags is a read; everything else (e.g. -D, -m) is a write
  if (sub === 'branch') {
    const op = args[1] ?? ''
    return op === '' || op === '--list' || op === '-l' || op === '-a' || op === '-r' || op === '--show-current'
  }
  // `remote` with no args or read-only subcommands is a read; add/remove/set-url etc. are writes
  if (sub === 'remote') {
    const op = args[1] ?? ''
    return op === '' || op === '-v' || op === 'show' || op === 'get-url'
  }
  return false
}

function dryRunLog(args: string[], cwd: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] cwd=${cwd}  git ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}\n`
  try {
    appendFileSync(DRY_RUN_LOG, line, 'utf8')
  } catch {
    // ignore write errors (e.g. read-only fs in CI)
  }
}

export interface GitRunOptions {
  cwd: string
  input?: string
  env?: NodeJS.ProcessEnv
  /**
   * Non-zero exit codes that should still be treated as success. The stdout
   * captured before the exit is returned. Useful for `git diff --no-index`
   * which exits 1 when files differ.
   */
  allowExitCodes?: number[]
}

export async function runGit(args: string[], opts: GitRunOptions): Promise<Result<string>> {
  if (DRY_RUN && !isReadOnly(args)) {
    dryRunLog(args, opts.cwd)
    return { ok: true, data: '' }
  }

  const env = {
    ...process.env,
    ...opts.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C'
  }

  // When stdin input is provided, use spawn (execFile/promisified does not
  // support writing to stdin).  Used by `git apply -` for hunk staging.
  if (opts.input !== undefined) {
    return runGitWithStdin(args, opts.input, opts.cwd, env, opts.allowExitCodes)
  }

  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: opts.cwd,
      maxBuffer: MAX_BUFFER,
      env
    })
    return { ok: true, data: stdout }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stderr?: string
      stdout?: string
      code?: number | string
    }
    const code = typeof e.code === 'number' ? e.code : 1
    if (opts.allowExitCodes?.includes(code)) {
      return { ok: true, data: e.stdout ? e.stdout.toString() : '' }
    }
    const stderr =
      (e.stderr && e.stderr.toString().trim()) ||
      e.message ||
      'git command failed'
    return { ok: false, code, stderr }
  }
}

function runGitWithStdin(
  args: string[],
  input: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  allowExitCodes?: number[]
): Promise<Result<string>> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      resolve({ ok: false, code: 1, stderr: err.message })
    })
    child.on('close', (code) => {
      const exitCode = code ?? 1
      if (exitCode === 0) {
        resolve({ ok: true, data: stdout })
        return
      }
      if (allowExitCodes?.includes(exitCode)) {
        resolve({ ok: true, data: stdout })
        return
      }
      resolve({
        ok: false,
        code: exitCode,
        stderr: stderr.trim() || `git ${args[0] ?? ''} exited with code ${exitCode}`
      })
    })
    child.stdin.end(input)
  })
}

export async function runGitVoid(args: string[], opts: GitRunOptions): Promise<Result<true>> {
  const res = await runGit(args, opts)
  if (!res.ok) return res
  return { ok: true, data: true }
}
