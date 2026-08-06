import fs from "fs";
import fsp from "fs/promises";
import path from "path";

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
 * Yield to the event loop after every N entries so libuv can close the file
 * descriptors the previous synchronous fs.* calls allocated. On Windows the
 * per-process fd budget is small (the GDI/User heap is ~512 entries for
 * non-interactive console processes by default; even when raw kHandle quota
 * is higher, a single Node process holding a deep recursive walk in the
 * synchronous event loop accumulates directory handles that are only closed
 * when the next libuv tick runs). 200 entries per tick keeps fd usage
 * bounded without making the walk visibly slower.
 */
const YIELD_EVERY = 200;

async function yieldFdBudget() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Recursively walk a node_modules directory and delete files/symlinks that
 * shouldPruneRuntimeDeadFile flags. Directories emptied by this pass are
 * removed too. Does not follow symlinked directories (fs.readdir with
 * withFileTypes reports a symlink-to-directory's isDirectory() as false, so
 * it is treated as a leaf entry and never recursed into).
 *
 * Async + periodic `setImmediate` yields are deliberate: a 634-package
 * node_modules tree produces ~100k+ filesystem entries; running the entire
 * walk synchronously exhausts the process fd budget before libuv can close
 * the directory handles, and the next `createWriteStream` (the seed archive
 * step) hits EMFILE on Windows.
 *
 * @param {string} nmDir - absolute path to a node_modules directory.
 * @returns {Promise<{ removedFiles: number, removedSize: number }>}
 */
export async function pruneRuntimeDeadFiles(nmDir) {
  let removedFiles = 0;
  let removedSize = 0;
  let opCount = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        try {
          const remaining = await fsp.readdir(full);
          if (remaining.length === 0) await fsp.rmdir(full);
        } catch {
          // Best-effort: directory may be gone already or non-empty due to a
          // concurrent process; not fatal to the prune pass.
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (shouldPruneRuntimeDeadFile(entry.name)) {
          try {
            const size = entry.isFile() ? (fs.statSync(full).size || 0) : 0;
            await fsp.unlink(full);
            removedFiles++;
            removedSize += size;
          } catch {
            // Best-effort: file may already be gone; not fatal to the prune pass.
          }
        }
      }
      opCount += 1;
      if ((opCount % YIELD_EVERY) === 0) await yieldFdBudget();
    }
  }

  await walk(nmDir);
  return { removedFiles, removedSize };
}
