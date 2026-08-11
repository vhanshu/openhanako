import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createHash } from "node:crypto";

/**
 * Walk up from `startDir` looking for a package-lock.json that signals
 * the repo root. Returns the absolute lockfile path, or null if none was
 * found within `maxLevels` parent directories. The walk is deliberately
 * bounded so a stray nested node_modules inside an unrelated temp dir
 * (vitest uses os.tmpdir() for some tests) cannot trick us into reading
 * the wrong lockfile.
 */
function findRepoLockfile(startDir, maxLevels = 6) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < maxLevels; i++) {
    const candidate = path.join(dir, "package-lock.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the prune cache directory for the repo that owns `nmDir`. Returns
 * null when we cannot locate the repo root (e.g. a bare test fixture); in
 * that case the caller falls through to a no-cache prune, which is correct
 * behavior — we'd rather run a slow prune than read a stale cache.
 */
function resolvePruneCacheDir(nmDir) {
  const lockfile = findRepoLockfile(nmDir);
  if (!lockfile) return null;
  const repoRoot = path.dirname(lockfile);
  return path.join(repoRoot, ".cache", "build-server-prune");
}

function readPruneCacheMarker(cacheDir, cacheKey) {
  const marker = path.join(cacheDir, `${cacheKey}.json`);
  if (!fs.existsSync(marker)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (
      typeof parsed.removedFiles === "number"
      && typeof parsed.removedSize === "number"
      && Number.isFinite(parsed.removedFiles)
      && Number.isFinite(parsed.removedSize)
    ) {
      return { removedFiles: parsed.removedFiles, removedSize: parsed.removedSize };
    }
  } catch {
    // Corrupt or partially-written marker — treat as a miss and recompute.
  }
  return null;
}

function writePruneCacheMarker(cacheDir, cacheKey, stats) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const marker = path.join(cacheDir, `${cacheKey}.json`);
  // Atomic-ish: write to a sibling tmp file then rename. Avoids leaving a
  // half-written JSON on the disk if the build is interrupted mid-write.
  const tmp = `${marker}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stats));
  fs.renameSync(tmp, marker);
}

/**
 * Runtime-dead file extensions that can never be loaded from node_modules
 * at server runtime: .ts/.mts/.cts source (Node refuses type stripping inside
 * node_modules), .map source maps (server ships with --enable-source-maps
 * never set), and .md docs (no runtime code path in node_modules reads
 * package-bundled markdown; the only .md reader in the dependency tree is a
 * vendored CLI --help path the server process never executes).
 */
const RUNTIME_DEAD_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".map", ".md"]);

/**
 * Basename prefixes that must be kept even when their extension matches
 * RUNTIME_DEAD_EXTENSIONS, to preserve third-party license/notice compliance
 * (e.g. LICENSE.md, LICENSE, NOTICE, COPYING.md).
 */
const PROTECTED_PREFIX_PATTERN = /^(license|licence|copying|notice)/i;

/**
 * Pure predicate: does this file basename represent dead weight that the
 * server bundle can never load at runtime from within node_modules?
 *
 * @param {string} fileName - basename only (not a path).
 * @returns {boolean}
 */
export function shouldPruneRuntimeDeadFile(fileName) {
  if (PROTECTED_PREFIX_PATTERN.test(fileName)) return false;
  const ext = path.extname(fileName).toLowerCase();
  return RUNTIME_DEAD_EXTENSIONS.has(ext);
}

/**
 * Whitelist counterpart: returns true for files that MUST remain in
 * node_modules at server runtime. Anything not in RUNTIME_DEAD_EXTENSIONS
 * plus license/notice/copying prefixes is considered live.
 *
 * `parentDirName` is the basename of the file's parent directory; this lets
 * `bin/` keep arbitrary extensionless executables that the package manager
 * symlinks there.
 */
export function shouldKeepRuntimeLiveFile(fileName, parentDirName) {
  if (PROTECTED_PREFIX_PATTERN.test(fileName)) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (RUNTIME_DEAD_EXTENSIONS.has(ext)) return false;
  // bin/ contains extensionless executables (tsc, eslint, ...). Keep
  // anything that lacks an extension when sitting directly under bin/.
  if (ext === "" && parentDirName === "bin") return true;
  // Everything else (.js, .cjs, .mjs, .json, .node, .wasm, .txt, ...) is live.
  return true;
}

/**
 * Concurrency & progress knobs. The previous single-threaded sync-unlink
 * walk blew past 10 minutes on Windows because each `fs.unlinkSync` round-
 * trips through NTFS metadata + Defender (~3-5ms each). Two changes flip
 * that:
 *   1. unlinkSync -> fsp.unlink + fsp.rm so libuv can coalesce syscalls and
 *      the event loop stays responsive to fd pressure;
 *   2. split the walk at the top-level package boundary (each `node_modules`
 *      subdir is independent) and run PACK_CONCURRENCY walkers in parallel,
 *      saturating NTFS instead of issuing one syscall at a time.
 *
 * PROGRESS_EVERY_FILES controls the file-count milestone log line; set
 * high enough that stderr stays readable (~2000 strikes a good balance for
 * the typical 25-35K dead-file workload).
 */
const PACK_CONCURRENCY = 8;
const PROGRESS_EVERY_FILES = 2000;

/**
 * Serialize writes to stderr so concurrent worker logs don't interleave
 * mid-line. process.stderr.write is synchronous on Unix but Node still
 * hands it to libuv on Windows, which means a flurry of overlapping calls
 * can produce torn output. A single chained Promise guarantees strict
 * line-atomicity without putting each call behind an awaited write.
 */
let logChain = Promise.resolve();
function log(msg) {
  const line = `[prune] ${msg}\n`;
  logChain = logChain.then(() => new Promise((resolve) => {
    if (process.stderr.write(line)) resolve();
    else process.stderr.once("drain", resolve);
  }));
  return logChain;
}

/**
 * Flatten the top level of `nmDir` into a list of leaf work items:
 *   - regular directories become a single `{ name, full, isDir: true }` entry;
 *   - `@scope/` directories are expanded into one entry per child
 *     (`@scope/pkg-a`, `@scope/pkg-b`, ...). Without this expansion, one
 *     worker would serialize an entire scope (e.g. all of @earendil-works/*)
 *     and concurrency collapses;
 *   - loose files / symlinks (`.package-lock.json`, `.modules.yaml`, ...)
 *     become single-file work items handled inline.
 *
 * Scope expansion is run with `Promise.all` rather than sequentially — on
 * Windows when Defender is cold-scanning a freshly-installed dist-server
 * tree, each per-scope readdir can cost tens of seconds in isolation, and
 * doing them serially adds up to several minutes before the first worker
 * can even pick up an item. Concurrent scope reads cut this to the
 * slowest single scope.
 *
 * Returns timing info alongside the items so the caller can log a
 * "this step took N ms" diagnostic when either step is slow (>500ms).
 */
async function listTopLevelWorkItems(nmDir) {
  const topStart = Date.now();
  let topEntries;
  try {
    topEntries = await fsp.readdir(nmDir, { withFileTypes: true });
  } catch {
    return { items: [], topMs: 0, scopeMs: 0, scopeCount: 0 };
  }
  const topMs = Date.now() - topStart;

  const items = [];
  const scopeTasks = [];

  for (const e of topEntries) {
    const full = path.join(nmDir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith("@")) {
        scopeTasks.push({ e, full });
      } else {
        items.push({ name: e.name, full, isDir: true });
      }
    } else if (e.isFile() || e.isSymbolicLink()) {
      items.push({ name: e.name, full, isDir: false });
    }
  }

  const scopeStart = Date.now();
  const scopeResults = await Promise.all(
    scopeTasks.map(async ({ e, full }) => {
      let subs;
      try { subs = await fsp.readdir(full, { withFileTypes: true }); }
      catch { return []; }
      return subs.map((sub) => ({
        name: `${e.name}/${sub.name}`,
        full: path.join(full, sub.name),
        isDir: sub.isDirectory(),
      }));
    })
  );
  const scopeMs = Date.now() - scopeStart;

  for (const subItems of scopeResults) {
    items.push(...subItems);
  }

  return { items, topMs, scopeMs, scopeCount: scopeTasks.length };
}

/**
 * Recursively walk a directory and delete dead files (and any directory
 * whose contents are all dead). `onRemoved` fires once per deletion
 * (including whole-subtree rmds) and is the only progress signal.
 *
 * Does NOT follow symlinked directories: readdir with withFileTypes reports
 * a symlink-to-dir's isDirectory() as false, so it lands in the file/symlink
 * branch and is treated as a leaf entry — which matches the previous
 * behavior and is what callers expect.
 */
async function pruneDeadTree(dir, totalStats, onRemoved) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  let allDead = entries.length > 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subAllDead = await pruneDeadTree(full, totalStats, onRemoved);
      if (subAllDead) {
        try {
          // Whole-subtree rm does NOT bump removedFiles: that's a directory
          // cleanup side effect, not a file deletion. Counting it would
          // inflate the "files removed" log line (and cache marker) by the
          // number of dead subtrees we found, which is misleading — the
          // caller's log line is what the user actually sees.
          await fsp.rm(full, { recursive: true, force: true });
        } catch { /* best-effort */ }
      } else {
        allDead = false;
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      if (shouldPruneRuntimeDeadFile(entry.name)) {
        try {
          await fsp.unlink(full);
          totalStats.removedFiles += 1;
          onRemoved();
        } catch { /* best-effort */ }
      } else {
        allDead = false;
      }
    }
  }

  return allDead;
}

/**
 * Run PACK_CONCURRENCY walkers over the top-level package list. Each
 * worker pulls one item at a time off a shared queue and emits a per-item
 * log line on completion so callers can watch the long tail (typically a
 * handful of large monorepo internals eating 80% of the wall time).
 *
 * Owns the prune-phase timing clock (`startMs` is captured AFTER
 * listTopLevelWorkItems returns, so the elapsed numbers reported in
 * milestone logs and the returned duration only reflect actual unlink
 * work — not the readdir scan that precedes it). Returns `{ startMs }`
 * so the caller can compute the final done-line stats consistently.
 *
 * Milestone logging is serialized through a Promise chain so concurrent
 * workers can't double-log the same milestone or write torn lines.
 */
async function pruneTopLevel(nmDir, totalStats) {
  const { items, topMs, scopeMs, scopeCount } = await listTopLevelWorkItems(nmDir);
  // Emit timing detail when either step is slow — typical symptom of
  // Defender cold-scanning a freshly-installed dist-server tree. On warm
  // dev node_modules this stays under 50ms and the line stays terse.
  const slow = topMs + scopeMs > 500;
  const detail = slow
    ? ` (top readdir: ${topMs}ms, ${scopeCount} scopes: ${scopeMs}ms)`
    : "";
  await log(`discovered ${items.length} top-level packages / loose files${detail}`);

  const startMs = Date.now();

  const queue = items.slice();
  let done = 0;
  const total = items.length;
  const workerCount = Math.min(PACK_CONCURRENCY, queue.length || 1);

  let lastReportedMilestone = 0;
  let milestoneChain = Promise.resolve();
  function scheduleMilestoneLog() {
    const milestone = Math.floor(totalStats.removedFiles / PROGRESS_EVERY_FILES)
      * PROGRESS_EVERY_FILES;
    if (milestone <= lastReportedMilestone || milestone <= 0) return;
    lastReportedMilestone = milestone;
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    milestoneChain = milestoneChain.then(() =>
      log(`${milestone} dead files removed (${elapsed}s elapsed)`)
    );
  }

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      const itemStart = Date.now();
      const local = { count: 0 };
      const fire = () => { local.count += 1; scheduleMilestoneLog(); };

      if (item.isDir) {
        await pruneDeadTree(item.full, totalStats, fire);
      } else if (shouldPruneRuntimeDeadFile(item.name)) {
        try {
          await fsp.unlink(item.full);
          totalStats.removedFiles += 1;
          fire();
        } catch { /* best-effort */ }
      }

      done += 1;
      const dur = ((Date.now() - itemStart) / 1000).toFixed(1);
      await log(
        `[${String(done).padStart(4)}/${total}] `
        + `${item.name.padEnd(48)} +${String(local.count).padStart(5)} dead (${dur}s)`
      );
    }
  });

  await Promise.all(workers);
  await milestoneChain;

  return { startMs };
}

/**
 * Recursively walk a node_modules directory and delete files/symlinks that
 * shouldPruneRuntimeDeadFile flags. Directories emptied by this pass are
 * removed too.
 *
 * Two distinct performance regimes are stacked here:
 *   - Single package: the recursive `pruneDeadTree` uses async fsp.unlink
 *     and fsp.rm so libuv can batch syscalls and the event loop stays
 *     responsive to fd pressure;
 *   - Across packages: `pruneTopLevel` runs PACK_CONCURRENCY walkers in
 *     parallel, each owning one top-level package dir. Concurrency is
 *     bounded by the top level (not the leaf dir) so a 100K-entry walk
 *     inside one giant package still gets coalesced by libuv.
 *
 * Caching: the prune is keyed on the repo's package-lock.json sha256, since
 * that hash uniquely captures the dependency graph that produced the
 * contents of `node_modules/`. When the lockfile is unchanged between
 * builds we can skip the entire walk and reuse the previous {removedFiles,
 * removedSize} totals. A lockfile hash miss triggers a full walk and writes
 * a fresh marker; markers live under `<repoRoot>/.cache/build-server-prune/`
 * which is already .gitignored.
 *
 * @param {string} nmDir - absolute path to a node_modules directory.
 * @returns {Promise<{ removedFiles: number, removedSize: number, cached: boolean }>}
 *   `cached: true` means the walk was skipped and stats were loaded from a
 *   previous marker; `cached: false` means a fresh walk ran.
 *
 * Note: `removedSize` is preserved for backward compatibility with the
 * single existing caller but is always 0; tracking per-file size would
 * require an extra `statSync` per deletion, which is the dominant cost on
 * Windows (NTFS metadata update + Defender scan). The caller logs file
 * count only.
 */
export async function pruneRuntimeDeadFiles(nmDir) {
  // ── Cache lookup ─────────────────────────────────────────────────────
  const cacheDir = resolvePruneCacheDir(nmDir);
  let cacheKey = null;
  if (cacheDir) {
    const lockfile = findRepoLockfile(nmDir);
    cacheKey = createHash("sha256")
      .update(fs.readFileSync(lockfile))
      .digest("hex")
      .slice(0, 16);
    const cached = readPruneCacheMarker(cacheDir, cacheKey);
    if (cached) {
      await log(`cache hit (${cacheKey.slice(0, 8)}…): skipped walk, previously removed ${cached.removedFiles} files`);
      return { ...cached, cached: true };
    }
  }

  // ── Cache miss: parallel prune-style black-list unlink ──────────────
  // Only touch the dead files (.ts/.mts/.cts/.map/.md), and when an entire
  // subtree is dead (e.g. `<pkg>/types/`, `dist-types/`, `build/`) take it
  // out in a single async fsp.rm({recursive:true}) instead of N unlinks +
  // N rmdirs. Top-level packages run in parallel so a single huge monorepo
  // package can't dominate the wall clock.
  const wallStartMs = Date.now();
  await log(
    `starting prune of ${nmDir} (cache miss${cacheKey ? `, key=${cacheKey.slice(0, 8)}…` : ""})`
  );

  const totalStats = { removedFiles: 0 };

  // pruneTopLevel captures startMs AFTER the (potentially slow) scan, so
  // the elapsed numbers in milestone logs and the done line only count
  // actual unlink work — not listTopLevelWorkItems.
  const { startMs } = await pruneTopLevel(nmDir, totalStats);

  const dur = ((Date.now() - startMs) / 1000).toFixed(1);
  const wallDur = ((Date.now() - wallStartMs) / 1000).toFixed(1);
  const rate = Math.round(totalStats.removedFiles / Math.max(0.1, (Date.now() - startMs) / 1000));
  await log(
    `done: ${totalStats.removedFiles} dead files removed in ${dur}s `
    + `(~${rate} files/s); wall ${wallDur}s incl. scan`
  );

  const cacheStats = { removedFiles: totalStats.removedFiles, removedSize: 0 };

  // ── Cache write (best-effort) ────────────────────────────────────────
  if (cacheDir && cacheKey) {
    try {
      writePruneCacheMarker(cacheDir, cacheKey, cacheStats);
    } catch {
      // Cache write failure is non-fatal — the prune already ran.
    }
  }

  return { ...cacheStats, cached: false };
}