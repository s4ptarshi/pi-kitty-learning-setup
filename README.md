# pi-kitty-learning-setup

Setup for running [pi](https://github.com/earendil-works/pi) with
[amosblomqvist/learn](https://github.com/amosblomqvist/learn) (an AI learning
system built on pi) inside [Kitty](https://sw.kovidgoyal.net/kitty/), with
interactive subagents (researcher, mermaid-maker, svg-maker) spawned as native
Kitty window splits instead of tmux panes.

## How it fits together

- **pi** — the coding/chat agent runtime. Everything below runs on top of it.
- **amosblomqvist/learn** — a `.pi` configuration (skills, extensions, agent
  definitions) that turns pi into a personal tutor. You clone it once to
  `~/learning/.pi` and treat it as a template.
- **amosblomqvist/pi-interactive-subagents** — a pi extension that lets the
  main session spawn subagents in their own terminal surface (originally
  tmux panes) and talk to them.
- **This repo** — swaps that extension's tmux backend for a Kitty backend
  (`pi-kitty-backend/tmux.ts`), and ships `learn-init`, a script that wires
  a fresh project up to use all of the above.

`learn-init`, run from the root of any git repo, will:

1. Verify prerequisites (rsync, kitty, conda, pi, the template at
   `~/learning`, the Kitty backend file).
2. `rsync` `~/learning/.pi` into `<project>/.pi`.
3. Symlink `<project>/.pi/extensions/visual-tools/node_modules` to the
   template's, so you don't `npm install` per project.
4. Install `pi-interactive-subagents` into the project via `pi install`.
5. Overwrite that extension's `tmux.ts` with the Kitty backend.
6. Add `.pi/` to the project's `.gitignore`.
7. Generate a `./start-learn <conda-env>` script in the project.

## Requirements

Install/verify each of these before running `learn-init`.

| Tool | Why | Checked with |
|---|---|---|
| [Kitty](https://sw.kovidgoyal.net/kitty/) | terminal; subagents are spawned as Kitty window splits via remote control | `kitty --version` (tested with 0.48.2) |
| [pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent` on npm) | the agent runtime everything runs on | `pi --version` (tested with 0.85.1) |
| Node.js + npm | to install `pi` globally and `visual-tools`' dependencies (`@mermaid-js/mermaid-cli`) | `node -v && npm -v` |
| [rsync](https://rsync.samba.org/) | `learn-init` copies the `.pi` template with it | `rsync --version` |
| [conda](https://docs.conda.io/) (Miniconda/Anaconda) | `start-learn` activates a conda env before launching `pi` | `conda --version` |
| `git` | the target project must already be a git repo; also used to clone the `learn` template | `git --version` |

### Kitty remote control

Subagent windows are created and controlled via `kitty @` remote control, so
your `kitty.conf` needs:

```conf
allow_remote_control yes
listen_on unix:/tmp/kitty
```

Without this, `pi-kitty-backend/tmux.ts` reports Kitty as unavailable and
subagents can't spawn (the main session still works without them).

### Environment variables

Nothing here needs a `.env` file — these are things that must already be
true in your shell when you run `learn-init` / `start-learn`:

| Variable | Set by | Required for |
|---|---|---|
| `PATH` must include the directory you install `learn-init` into (e.g. `~/.local/bin`) | you, once | running `learn-init` by name |
| `PATH` must include npm's global bin dir (e.g. `~/.local/npm/bin` — check with `npm config get prefix`) | you, once | `pi` being on `PATH` |
| `KITTY_WINDOW_ID` | set automatically by Kitty for every process it spawns | `start-learn` refuses to run without it — it's how the script knows you're inside a real Kitty window and not, say, a plain xterm or a tmux session inside Kitty |

`learn-init` and `start-learn` locate `conda` dynamically (checking `PATH`,
then `/data/miniconda3/bin/conda`, `~/miniconda3/bin/conda`, and
`/netscratch/bhattach/miniconda3/bin/conda` in that order) — no env var
needed, but if your conda lives elsewhere, edit those fallback paths in
`bin/learn-init`.

## Install

### 1. Install pi and the learn template

```bash
npm install -g @earendil-works/pi-coding-agent

git clone https://github.com/amosblomqvist/learn ~/learning/.pi
cd ~/learning/.pi/extensions/visual-tools
npm install
```

### 2. Install this repo's script and Kitty backend

```bash
git clone https://github.com/s4ptarshi/pi-kitty-learning-setup.git
cd pi-kitty-learning-setup

mkdir -p ~/.local/bin ~/.local/share/pi-kitty-backend
cp bin/learn-init ~/.local/bin/learn-init
cp pi-kitty-backend/tmux.ts ~/.local/share/pi-kitty-backend/tmux.ts
chmod +x ~/.local/bin/learn-init
```

Make sure `~/.local/bin` is on your `PATH` (add `fish_add_path -g ~/.local/bin`
to `config.fish`, or `export PATH="$HOME/.local/bin:$PATH"` for bash/zsh).

### 3. Enable Kitty remote control

Add to `~/.config/kitty/kitty.conf`:

```conf
allow_remote_control yes
listen_on unix:/tmp/kitty
```

Reload Kitty config (`ctrl+shift+F5`) or restart Kitty.

## Usage

From the root of any existing git repo you want to learn/study inside of:

```bash
cd ~/path/to/your/project
learn-init
```

Expected output ends with:

```
==============================================
 Learning environment installed
==============================================
...
Start with:
  ./start-learn <conda-environment>
```

This is a one-time setup per project — `learn-init` refuses to run again if
`.pi/` or `start-learn` already exist.

Then, from inside a Kitty window in that same project:

```bash
./start-learn <conda-environment>
```

`<conda-environment>` must already exist (`conda env list` to check). The
script activates it and execs `pi`, so the agent runs with that
environment's Python/tools on `PATH`.

## Troubleshooting

- **"Kitty subagent backend not found"** — you skipped step 2 above; copy
  `pi-kitty-backend/tmux.ts` to `~/.local/share/pi-kitty-backend/tmux.ts`.
- **"not running inside Kitty (KITTY_WINDOW_ID is unset)"** — run
  `start-learn` directly in a Kitty window, not inside tmux/screen or a
  different terminal emulator.
- **Subagents fail to spawn / "Kitty remote control is required"** — check
  `allow_remote_control` and `listen_on` are set in `kitty.conf` and that you
  reloaded/restarted Kitty; verify with `kitty @ ls`.
- **"visual-tools dependencies are not installed"** — run `npm install` in
  `~/learning/.pi/extensions/visual-tools`.
- **"Conda environment '<name>' does not exist"** — run `conda env list` and
  pass one of the listed names to `start-learn`.

## Contents

- `bin/learn-init` — the setup script described above.
- `pi-kitty-backend/tmux.ts` — drop-in replacement for
  `pi-interactive-subagents`'s tmux backend that drives Kitty windows instead
  of a tmux session. Re-copy this over the installed copy under
  `<project>/.pi/git/.../pi-interactive-subagents/pi-extension/subagents/tmux.ts`
  any time you run `pi update --extensions`, since that command resets it.
