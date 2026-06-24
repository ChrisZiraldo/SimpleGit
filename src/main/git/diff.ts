import type { Result } from '@shared/types'
import { runGit } from './runner'

export async function getFileDiff(
  cwd: string,
  path: string,
  staged: boolean
): Promise<Result<string>> {
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', path)
  const res = await runGit(args, { cwd })
  if (!res.ok) return res

  if (!staged && res.data.trim() === '') {
    // Only use the --no-index fallback if the file is genuinely untracked.
    // A tracked file with only staged changes also returns an empty unstaged
    // diff; without this guard the entire file would appear as a new addition.
    const tracked = await runGit(['ls-files', '--error-unmatch', '--', path], { cwd })
    if (!tracked.ok) {
      // File is untracked — show it as a new addition
      const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const untrackedDiff = await runGit(
        ['diff', '--no-color', '--no-index', '--', nul, path],
        { cwd, allowExitCodes: [1] }
      )
      if (untrackedDiff.ok) return { ok: true, data: untrackedDiff.data }
    }
  }
  return res
}
