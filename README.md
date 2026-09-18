# pi-kitty-learning-setup

Setup for running the [pi learning environment](https://github.com/amosblomqvist/learn)
inside Kitty, with interactive subagents backed by Kitty windows instead of tmux.

## Contents

- `bin/learn-init` — copies `~/learning/.pi` into the current git repo, links
  `visual-tools` node_modules, installs `pi-interactive-subagents`, and patches
  in the Kitty backend below. Creates a `./start-learn <conda-env>` script.
- `pi-kitty-backend/tmux.ts` — drop-in replacement for
  `pi-interactive-subagents`'s tmux backend that drives Kitty windows instead
  of a tmux session.

## Requirements

- [`pi`](https://github.com/amosblomqvist/learn) installed and on `PATH`
- A local clone of the [`learn`](https://github.com/amosblomqvist/learn) repo at `~/learning`
  (with `.pi/extensions/visual-tools` dependencies installed via `npm install`)
- `rsync`, `kitty`, and `conda`

## Install

```bash
mkdir -p ~/.local/bin ~/.local/share/pi-kitty-backend
cp bin/learn-init ~/.local/bin/learn-init
cp pi-kitty-backend/tmux.ts ~/.local/share/pi-kitty-backend/tmux.ts
chmod +x ~/.local/bin/learn-init
```

## Usage

From the root of any git repo:

```bash
learn-init
./start-learn <conda-environment>
```

Run `./start-learn` from inside a Kitty window (`KITTY_WINDOW_ID` must be set).
