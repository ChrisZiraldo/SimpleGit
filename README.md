<p align="center">
  <img src="logo.png" alt="Git Express" width="600" />
</p>

> **Read your repository like a subway map.**
> A polished, fast Electron-based Git client that turns your branch history into a London Underground–style transit diagram — with full staging, CI status, PR reviews, interactive rebase, and more, all without leaving the app.

---

## ✨ What it looks like

Every branch is a colour-coded metro line. Commits are stations. Merges are interchange hubs. Scroll the map, click a station to inspect it, double-click to check it out.

---

## 🛠 Prerequisites

Git Express shells out to `git` and the GitHub CLI (`gh`) for network operations and CI data. Both must be on your `PATH` before you launch the app.

### 1 — Install Homebrew (if you haven't already)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2 — Install Git

macOS ships a version of Git, but Homebrew's is newer and faster:

```bash
brew install git
git --version   # should print 2.40+
```

### 3 — Install the GitHub CLI

```bash
brew install gh
gh --version
```

### 4 — Authenticate with GitHub

```bash
gh auth login
# Follow the interactive prompts — choose GitHub.com → HTTPS → browser login
gh auth status   # should show "Logged in to github.com"
```

CI status badges, PR listings, PR diffs, and reviews all rely on `gh`. If it isn't authenticated the app works fine but CI columns will stay empty.

---

## 🚀 Running in development

```bash
# Clone
git clone https://github.com/your-org/gitExpress.git
cd gitExpress

# Install dependencies
npm install

# Start the Electron dev server (hot-reload on changes)
npm run dev
```

### Build a distributable

```bash
npm run build          # compile only
npm run dist           # compile + package as a native .app / .exe / .deb
```

---

## 🗺 The Metro Map

The heart of Git Express is the **Map** tab — a vertical transit diagram of your repository.

| Visual element | What it means |
|---|---|
| Coloured vertical line | A branch (each branch gets a unique colour) |
| Circle on a line | A commit station |
| Filled circle | Merge / interchange — multiple branches met here |
| Glowing circle with inner dot | HEAD — the commit you're currently on |
| Hollow circle with ✕ | Abandoned tip — stale branch with no upstream |
| Flag badge | Tagged commit (release / version) |
| Dotted horizontal line | Commit message label lead-in |

### Navigating the map

- **Scroll** vertically to travel through history (newest at top, oldest at bottom)
- **Scroll horizontally** to see all branches side-by-side
- **Pinch / Ctrl+scroll** to zoom in or out
- **Click a station** to select it and open Station Details on the right
- **Double-click a station** to check out that branch (or detach HEAD at that commit)
- **Click empty space** to deselect
- **Click a branch pill** on the left to jump the map to that branch's HEAD
- **Double-click a branch pill** to check out that branch
- **HEAD button** in the toolbar to instantly scroll back to your current branch tip
- **Fit button** to zoom/fit everything currently visible on screen

### Branch pills (left edge)

Each branch has a sticky pill pinned to the left edge of the map. A horizontal connector line leads from the pill to the branch's HEAD station. The `HEAD` badge appears on whichever branch you're currently on.

---

## ⚙️ Toolbar actions

| Button | Action |
|---|---|
| **Fetch** | `git fetch --all --prune` |
| **Pull** | `git pull` on the current branch |
| **Push** | `git push` (sets upstream if needed) |
| **HEAD** | Smooth-scroll the map to your current HEAD station |
| **Reset** | Hard-reset to `origin/<branch>` (with upstream) or `git reset --hard HEAD` (no upstream). Requires a second click to confirm. |
| **Branch** | Create a new branch from HEAD |
| **Stash** | Stash current working changes |
| **Pop** | Pop the most recent stash |
| **Fit** | Zoom-to-fit the visible stations |
| **CI** | Clear the CI cache and re-fetch status for all visible stations |
| **.gitignore** | Open the repo's `.gitignore` in an in-app editor |
| **Settings** | Configure Cursor API key and commit-message formatting rules |

The **Fetch** and **CI** refresh also run **automatically every 60 seconds** in the background.

---

## 📋 Staging & committing

The right panel shows **Changes** (unstaged) and **Staged** sections.

- **Click a file** to open a side-by-side diff
- **Stage / unstage** individual files, hunks, or individual lines
- **Discard** hunks or lines you don't want
- Type a commit message and click **Commit** or **Commit & Push**
- Check **Amend** to rewrite the last commit (warns you if it's already pushed)
- The **Generate** button uses your Cursor API key + formatting rules to write the message for you

---

## 🔍 Commit search

Press **⌘F** (or `/` from the map) to open the floating search bar. Type any part of a commit message, author name, or short hash — matching stations stay bright while the rest dim.

---

## 🌿 Branch management

Right-click any **branch pill** or **sidebar branch row** for:

- **Checkout** the branch
- **Push `<branch>`** — explicit per-branch push
- **Pull `<branch>`** — explicit per-branch pull
- **Delete** (force-deletes the local branch)
- **Branch from here…** — create a new branch off that exact commit

Hold **Shift** or **Ctrl/⌘** while clicking branches in the sidebar to multi-select, then right-click to delete several at once.

---

## 🤖 CI Status

When `gh` is authenticated, every station in the current viewport gets a CI rollup badge:

| Badge | Meaning |
|---|---|
| ✅ green | All checks passed |
| ❌ red | One or more checks failed |
| 🟡 yellow | Checks pending / in progress |
| Grey | No PR / no checks configured |

Click a station to see the full check list in **Station Details**. Right-click any check to **Re-run** it, **Re-run all jobs**, or **Re-run failed jobs**.

---

## 🔀 Pull Requests

Switch to the **Pull Requests** tab to see all open PRs.

- **PR list** shows title, author, CI rollup, draft status, and merge state
- **Click a PR** to open the detail pane:
  - Full unified diff with syntax-highlighted additions/deletions per file
  - **Approve**, **Request changes**, or **Comment** inline
- **Create PR** button when your branch has no open PR yet — set title, body, base branch, and draft status

---

## ♻️ Interactive Rebase

Right-click any commit station and choose **Start rebase from here…** to open the **Rebase Panel**:

- All commits between HEAD and the selected commit are listed
- **Drag and drop** to reorder
- Per-commit action dropdown: `pick`, `squash`, `fixup`, `drop`
- **Run Rebase** executes `git rebase -i` via `GIT_SEQUENCE_EDITOR`
- If conflicts arise, Git Express drops you into the **Conflict Editor**

---

## ⚔️ Conflict Resolution

When a merge or rebase hits a conflict, the conflicted file is highlighted in the Status panel. Click it (or the conflict badge on the map) to open the **3-way Conflict Editor**:

| Column | Content |
|---|---|
| **Ours** | Your version |
| **Merged** (centre, editable) | The combined result you can freely edit |
| **Theirs** | The incoming version |

Buttons: **Use Ours**, **Use Theirs**, **Use Both**, **Mark Resolved**, **Continue Merge / Rebase**, **Abort**.

---

## ↩️ Undo stack

Destructive operations (cherry-pick, revert, amend, reset) capture HEAD before they run. A toast appears with an **Undo** button. Press **⌘Z** at any time to step back through the undo stack via `git reset --hard <saved-SHA>`.

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `F` | Fetch |
| `P` | Push |
| `Shift P` | Pull |
| `1 – 4` | Switch tabs (Map / Pull Requests / Insights / Authors) |
| `/` | Focus branch filter in sidebar |
| `⌘F` | Open commit search |
| `Esc` | Clear selection / close search |
| `⌘Z` | Undo last destructive operation |
| `?` | Show all shortcuts overlay |

---

## 🗂 Sidebar

The left sidebar shows:

- **Repository** selector with recent repos
- **Local Branches** — filterable by name, with commit-distance badge (commits ahead of `main`)
- **Remote Branches** — all remote tracking refs (collapsible)
- **Visibility filters** — toggle merged branches, stale branches, CI filter, author filter, date range
- **Legend** — map symbol guide
- **Stashes** — list with pop/drop actions

---

## 🛡 Dry-run mode

Set `SIMPLEGIT_DRY_RUN=1` before launching to log all write git commands to `dry-run.log` instead of executing them. Read-only commands (`log`, `status`, `diff`, etc.) still run so the UI is fully populated.

```bash
SIMPLEGIT_DRY_RUN=1 npm run dev
```

---

## 🏗 Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 33 |
| Renderer | React 19 + TypeScript |
| Build | electron-vite + Vite 5 |
| Styling | Tailwind CSS + inline styles |
| State | Zustand |
| Git operations | `git` CLI via `child_process` |
| GitHub integration | `gh` CLI via `child_process` |
| Visualisation | SVG (hand-rolled metro-map renderer) |

---

## 📄 License

MIT
