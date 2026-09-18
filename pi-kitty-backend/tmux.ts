/**
 * Kitty surface layer — replaces pi-interactive-subagents' tmux.ts so
 * subagents spawn as native Kitty windows (splits) instead of tmux panes.
 *
 * This file is a drop-in replacement: it exports the exact same surface API
 * (createSurface, sendCommand, readScreen, closeSurface, pollForExit, ...)
 * that pi-extension/subagents/index.ts imports from "./tmux.ts". index.ts is
 * never modified — only this file is swapped in, via
 * scripts/apply-pi-kitty-backend.sh (see that script for why: the installed
 * package under .pi/git/... gets reset by `pi update --extensions`, so this
 * project-tracked copy is the source of truth and must be re-applied after
 * every update).
 *
 * Surfaces are identified by Kitty window ids (e.g. "42"), communicated to
 * via `kitty @` remote control (requires allow_remote_control + listen_on in
 * kitty.conf). Splits always target the parent pi's window (KITTY_WINDOW_ID)
 * so they follow the agent rather than the user's focus, mirroring tmux.ts's
 * use of $TMUX_PANE.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Availability ──

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

/**
 * True when running inside Kitty with remote control reachable and the
 * `kitty` binary on PATH. `KITTY_WINDOW_ID` is set by Kitty in every process
 * it spawns. Remote control needs either `KITTY_LISTEN_ON` or a working
 * `--to` default (the controlling terminal), so a lightweight `kitty @ ls`
 * probe confirms control actually works, not just that the env var exists.
 */
export function isTmuxAvailable(): boolean {
  if (!process.env.KITTY_WINDOW_ID || !hasCommand("kitty")) return false;
  try {
    execFileSync("kitty", ["@", "ls", "--match", `id:${process.env.KITTY_WINDOW_ID}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function isMuxAvailable(): boolean {
  return isTmuxAvailable();
}

export function muxSetupHint(): string {
  return (
    "Run pi directly inside a Kitty window, and make sure kitty.conf has " +
    "`allow_remote_control yes` and a `listen_on` socket configured."
  );
}

function requireTmux(): void {
  if (!isTmuxAvailable()) {
    throw new Error(`Kitty remote control is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Escape text for `kitty @ send-text`, which interprets Python-style escapes
 * (`\n`, `\e`, ...) in its argument. Doubling backslashes makes the payload
 * round-trip literally, matching tmux.ts's `send-keys -l` (strictly literal).
 */
function kittyTextEscape(s: string): string {
  return s.replace(/\\/g, "\\\\");
}

// ── Pane layout ──

let rebalanceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-balance subagent windows so repeated splits don't leave them lopsided.
 * Kitty's `splits` layout keeps window sizes reasonable on its own, but a
 * burst of parallel spawns or staggered exits can still leave things uneven;
 * `layout_action equalize` re-flows the current tab. Debounced so a burst of
 * spawns/exits collapses into a single call, and non-fatal: a cosmetic
 * resize must never break spawning or watching.
 */
function rebalanceSurfaces(): void {
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    try {
      execFileSync("kitty", ["@", "action", "layout_action", "equalize"], {
        encoding: "utf8",
      });
    } catch {
      // Window/tab may be gone; balancing is best-effort.
    }
  }, 120);
}

// ── Surface primitives ──

/**
 * Create a new surface for a subagent: a right split off the parent pi's
 * window, so new windows follow the agent rather than the user's focus.
 *
 * Returns the new Kitty window id (e.g. `42`).
 */
export function createSurface(name: string): string {
  void name; // Kitty windows are not named; the pi process inside sets its own title.
  return createSurfaceSplit(name, "right", process.env.KITTY_WINDOW_ID);
}

/**
 * Create a new split in the given direction from an optional source window.
 * Returns the new Kitty window id (e.g. `42`).
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  requireTmux();

  const location = direction === "left" || direction === "right" ? "vsplit" : "hsplit";
  const args = ["@", "launch", "--type=window", "--location", location, "--cwd=current", "--keep-focus"];
  if (fromSurface) {
    args.push("--next-to", `id:${fromSurface}`);
  }
  // "before" puts the new window to the left/above the target; default
  // placement (omit --location=before) is right/below, matching "right"/"down".
  if (direction === "left" || direction === "up") {
    args.push("--location", "before");
  }
  args.push("bash");

  const windowId = execFileSync("kitty", args, { encoding: "utf8" }).trim();
  if (!/^\d+$/.test(windowId)) {
    throw new Error(`Unexpected kitty launch output: ${windowId}`);
  }

  rebalanceSurfaces();
  return windowId;
}

/**
 * Send a command string to a window and execute it.
 * Backslashes are doubled so `send-text`'s Python-escape parsing doesn't
 * reinterpret the payload, then Enter is sent as a separate key event
 * (mirrors tmux.ts's two-step `send-keys -l` + `send-keys Enter`).
 */
export function sendCommand(surface: string, command: string): void {
  requireTmux();
  execFileSync("kitty", ["@", "send-text", "--match", `id:${surface}`, kittyTextEscape(command)], {
    encoding: "utf8",
  });
  execFileSync("kitty", ["@", "send-key", "--match", `id:${surface}`, "enter"], {
    encoding: "utf8",
  });
}

/**
 * Send a long command to a window by writing it to a script file first.
 * This avoids terminal line-wrapping issues that break commands exceeding the
 * window's column width when sent character-by-character via sendCommand.
 *
 * By default the script is written to a temp directory, but callers can pass a
 * stable path (for example under session artifacts) so the exact invocation is
 * preserved for debugging.
 *
 * Returns the script path.
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    scriptParts.push(options.scriptPreamble.trimEnd());
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", {
    mode: 0o755,
  });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * Read the screen contents of a window (sync).
 * `--extent=all` includes scrollback, matching tmux.ts's `capture-pane -S -N`.
 */
export function readScreen(surface: string, lines = 50): string {
  requireTmux();
  const text = execFileSync("kitty", ["@", "get-text", "--match", `id:${surface}`, "--extent=all"], {
    encoding: "utf8",
  });
  return tailLines(text, lines);
}

/**
 * Read the screen contents of a window (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireTmux();
  const { stdout } = await execFileAsync(
    "kitty",
    ["@", "get-text", "--match", `id:${surface}`, "--extent=all"],
    { encoding: "utf8" },
  );
  return tailLines(stdout, lines);
}

function tailLines(text: string, lines: number): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - Math.max(1, lines))).join("\n");
}

/**
 * Close a window.
 */
export function closeSurface(surface: string): void {
  requireTmux();
  execFileSync("kitty", ["@", "close-window", "--match", `id:${surface}`], { encoding: "utf8" });
  rebalanceSurfaces();
}

// ── Exit polling ──

export interface PollResult {
  /** How the subagent exited */
  reason: "done" | "sentinel" | "error";
  /** Shell exit code (from sentinel). 0 for file-based exits. */
  exitCode: number;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
}

/**
 * Interpret an `.exit` sidecar payload (written by the error path in
 * subagent-done.ts). Centralized so both the fast and slow paths in
 * pollForExit decode the payload the same way. Clean completions write no
 * sidecar and are detected via the terminal sentinel instead.
 *
 * Note: ask_question does NOT write a `.exit` sidecar — it keeps the session
 * open and signals the parent via a separate `.ask` file (see deliverPendingQuestion).
 */
function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

/**
 * Poll until the subagent exits. Checks for a `.exit` sidecar file first
 * (written by the error path), falling back to the terminal sentinel for
 * clean-completion and crash detection.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Fast path: check for .exit sidecar file (written by the error path)
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    // Check Claude sentinel file (written by plugin Stop hook)
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // Slow path: read terminal screen for sentinel (crash detection)
    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      // Surface may have been destroyed — check if .exit file appeared in the meantime
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
