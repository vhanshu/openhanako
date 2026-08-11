#!/usr/bin/env node
/**
 * Build the self-contained Windows HanaCore archive published alongside the
 * desktop installer.
 *
 * This is deliberately a second packaging boundary. The existing
 * dist-server-artifact/<platform-arch>/server-*.tar.gz files stay lean because they are
 * embedded as Electron seed content and reused by the OTA train. Putting
 * MinGit or the sandbox helper in that tree would duplicate them inside the
 * installer and redownload them with every content update.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";

import { assertRuntimeComplete, MINGIT_VERSION } from "./mingit-runtime.js";

const require = createRequire(import.meta.url);
const ustar = require("../shared/artifact-core/ustar.cjs");
const activation = require("../shared/artifact-core/activation.cjs");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");
export const STANDALONE_LAYOUT_ROOT = "HanaCore";
export const STANDALONE_PLATFORM = "win32";
export const STANDALONE_ARCH = "x64";

export const REQUIRED_STANDALONE_SERVER_FILES = [
  "hana.cmd",
  "hana-server.cmd",
  "hana-server.exe",
  "bootstrap.js",
  "bundle/index.js",
  "bundle/cli.js",
];

function assertSafeVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`[standalone] invalid product version: ${JSON.stringify(version)}`);
  }
}

function assertDirectory(dirPath, label) {
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    throw new Error(`[standalone] ${label} directory is missing: ${dirPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`[standalone] ${label} must be a directory: ${dirPath}`);
  }
}

function assertFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`[standalone] ${label} is missing: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`[standalone] ${label} must be a file: ${filePath}`);
  }
}

export function readProductVersion(rootDir = ROOT) {
  const packagePath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assertSafeVersion(packageJson.version);
  return packageJson.version;
}

export function standaloneArtifactNames(version, arch = STANDALONE_ARCH) {
  assertSafeVersion(version);
  if (arch !== STANDALONE_ARCH) {
    throw new Error(`[standalone] unsupported Windows architecture ${arch}; only ${STANDALONE_ARCH} is published`);
  }
  const stem = `HanaCore-${version}-Windows-${arch}`;
  const archiveName = `${stem}.tar.gz`;
  if (archiveName.startsWith("server-")) {
    throw new Error(`[standalone] archive name must never overlap the OTA server-* namespace: ${archiveName}`);
  }
  return {
    archiveName,
    manifestName: `${stem}.manifest.json`,
  };
}

export function standaloneWrapperContents() {
  const common = [
    "@echo off",
    "setlocal",
    'set "HANA_ROOT=%~dp0server"',
    'set "HANA_SERVER_ENTRY=%~dp0server\\bundle\\index.js"',
    'set "HANA_WIN32_SANDBOX_HELPER=%~dp0sandbox\\windows\\hana-win-sandbox.exe"',
    'set "PATH=%~dp0git\\cmd;%~dp0git\\usr\\bin;%~dp0git\\mingw64\\bin;%PATH%"',
  ];
  return {
    hana: [...common, '"%~dp0server\\hana-server.exe" "%~dp0server\\bundle\\cli.js" %*', ""].join("\r\n"),
    server: [...common, '"%~dp0server\\hana-server.exe" "%~dp0server\\bootstrap.js" %*', ""].join("\r\n"),
  };
}

function assertServerTree(serverDir) {
  assertDirectory(serverDir, "packaged server");
  for (const relative of REQUIRED_STANDALONE_SERVER_FILES) {
    assertFile(path.join(serverDir, ...relative.split("/")), `packaged server file ${relative}`);
  }
}

function assertArtifactOutputIsSeparate({ rootDir, serverDir, artifactOutDir }) {
  const resolvedArtifactOutDir = path.resolve(artifactOutDir);
  const relative = path.relative(path.resolve(serverDir), resolvedArtifactOutDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("[standalone] artifact output must stay outside dist-server; the source runtime is immutable");
  }
  const serverArtifactRoot = path.resolve(rootDir, "dist-server-artifact");
  const relativeToServerArtifacts = path.relative(serverArtifactRoot, resolvedArtifactOutDir);
  if (
    relativeToServerArtifacts === ""
    || (!relativeToServerArtifacts.startsWith("..") && !path.isAbsolute(relativeToServerArtifacts))
  ) {
    throw new Error("[standalone] standalone artifacts must not enter dist-server-artifact (Electron seed / OTA boundary)");
  }
  const expectedOutputDir = path.resolve(rootDir, "dist-standalone");
  if (resolvedArtifactOutDir !== expectedOutputDir) {
    throw new Error(
      `[standalone] artifact output must be the dedicated dist-standalone directory: ${expectedOutputDir}`,
    );
  }
}

/**
 * Structural hash of a directory tree (or single file): relative path + size
 * + mtimeMs for every entry, fed into a sha256. We deliberately avoid reading
 * file contents — the cpSync upstream keeps `preserveTimestamps: true`, so
 * mtime is a reliable proxy for "content unchanged since last build". On
 * Windows this lets us hash a 600MB server tree in <1s, vs. minutes for a
 * full content hash.
 */
function hashTreeSync(rootPath) {
  const hash = createHash("sha256");
  const resolved = path.resolve(rootPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    hash.update(`file:${path.basename(resolved)}:${stat.size}:${Math.floor(stat.mtimeMs)}\0`);
    return hash.digest("hex");
  }
  hash.update(`tree:${resolved}\0`);
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(resolved, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const st = fs.statSync(full);
        hash.update(`file:${rel}:${st.size}:${Math.floor(st.mtimeMs)}\0`);
      } else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        hash.update(`symlink:${rel}:${target}\0`);
      }
    }
  }
  walk(resolved);
  return hash.digest("hex");
}

/**
 * Combined cache key over (version + serverDir + gitDir + helperPath). Version
 * is mixed in so bumping package.json invalidates the cache even if the
 * runtime trees happen to be byte-identical to a previous version's.
 */
// Walks up from `startDir` looking for a package-lock.json. The lockfile
// is the source of truth for everything that npm install produces, so
// its content hash is a good proxy for "did serverDir change since last
// build". Returns null when the fixture is not inside a repo (test envs).
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

function hashFileContentSync(filePath) {
  // Single-file sha256 of the file bytes. Used for small inputs (lockfile,
  // helper exe) where a full content hash is cheap and removes the
  // mtime-driven false misses we kept getting from vite re-emitting
  // bundle.js on every rebuild.
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Content-aware tree hash: reads every file and mixes its full sha256 in.
// Used only for the small gitDir (mingit, a few hundred MB) and only on
// cache miss; cache hits skip this entirely. Replaces the old mtime+size
function hashTreeContentSync(rootPath) {
  const hash = createHash("sha256");
  hash.update(`tree:${path.resolve(rootPath)}\0`);
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hash.update(`file:${full}:${hashFileContentSync(full)}\0`);
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink:${full}:${fs.readlinkSync(full)}\0`);
      }
    }
  }
  if (fs.statSync(rootPath).isDirectory()) walk(rootPath);
  else hash.update(`file:${rootPath}:${hashFileContentSync(rootPath)}\0`);
  return hash.digest("hex");
}

// Cache key built from the inputs that actually determine the archive
//   - version: drives the wrapper .cmd scripts and archive filename
//   - lockfile content: covers everything npm install puts into serverDir
//     (lockfile is the source of truth for the dependency graph).
//   - helper content: sandbox exe is a separately-versioned binary that
//     can change without lockfile moving.
//   - gitDir content: mingit runtime, large but rarely changes; full
//     content hash only computed on cache miss.
// serverDir itself is NOT hashed here: the lockfile + helper + version
// triple uniquely determines the build output, and avoiding a 600MB walk
// on every cache lookup is the whole point.
function hashStandaloneInputs({ version, serverDir, gitDir, helperPath }) {
  const hash = createHash("sha256");
  hash.update(`version:${version}\0`);
  const lockfile = findRepoLockfile(serverDir);
  if (lockfile) {
    hash.update(`lockfile:${hashFileContentSync(lockfile)}\0`);
  } else {
    // No lockfile (test fixture) — fall back to serverDir content hash so
    // tests still get correct invalidation, just slower.
    hash.update(`server:${hashTreeContentSync(serverDir)}\0`);
  }
  hash.update(`helper:${hashFileContentSync(helperPath)}\0`);
  hash.update(`git:${hashTreeContentSync(gitDir)}\0`);
  return hash.digest("hex").slice(0, 32);
}

function readStandaloneCacheMarker(cacheDir, cacheKey) {
  const marker = path.join(cacheDir, `${cacheKey}.json`);
  if (!fs.existsSync(marker)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (
      typeof parsed.sha256 === "string"
      && typeof parsed.size === "number"
      && typeof parsed.archiveName === "string"
    ) {
      return parsed;
    }
  } catch {
    // Corrupt marker — treat as a miss.
  }
  return null;
}

function writeStandaloneCacheMarker(cacheDir, cacheKey, payload) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const marker = path.join(cacheDir, `${cacheKey}.json`);
  const tmp = `${marker}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, marker);
}

/**
 * Copy `srcDir` into `dstDir` using NTFS hardlinks instead of duplicating
 * file content. On Windows a hardlink is O(1) regardless of file size; on the
 * serverDir (~600MB) and gitDir (~hundreds of MB) this turns the staging
 * copy from minutes into seconds. Hardlinks share an inode with the source,
 * so mtime/atime come along for free.
 *
 * Edge cases handled by fallbacks:
 *   - Symlinks: re-created as symlinks (cpSync's `dereference: false` mode).
 *     If `symlinkSync` fails (rare on Windows due to SeCreateSymbolicLinkPrivilege
 *     or developer-mode requirement) we copy the resolved bytes instead.
 *   - Cross-volume / no-link-privilege: `linkSync` raises EXDEV / EPERM /
 *     ENOTSUP and we fall back to `copyFileSync` with COPYFILE_PRESERVE_TIMESTAMP
 *     to keep mtime stable, matching cpSync's `preserveTimestamps: true`.
 */
function hardlinkCopySync(srcDir, dstDir, log = () => {}) {
  let linked = 0;
  let copied = 0;
  let symlinked = 0;
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const sub = hardlinkCopySync(src, dst, log);
      linked += sub.linked;
      copied += sub.copied;
      symlinked += sub.symlinked;
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(src);
      try {
        fs.symlinkSync(target, dst);
        symlinked++;
      } catch {
        // Symlink privilege missing or unsupported — fall back to a real copy
        // of the resolved content. The original tree's symlink semantics are
        // best-effort, but the runtime layout never depends on symlinks.
        fs.copyFileSync(src, dst, fs.constants.COPYFILE_PRESERVE_TIMESTAMP);
        copied++;
      }
    } else if (entry.isFile()) {
      try {
        fs.linkSync(src, dst);
        linked++;
      } catch (err) {
        if (err && (err.code === "EXDEV" || err.code === "EPERM" || err.code === "ENOTSUP" || err.code === "EACCES")) {
          // Different volume, or lacking SeCreateHardlinkPrivilege — fall
          // back to a full copy. This path is hit on dev machines where
          // cross-volume staging or restricted policies apply.
          fs.copyFileSync(src, dst, fs.constants.COPYFILE_PRESERVE_TIMESTAMP);
          copied++;
        } else {
          throw err;
        }
      }
    }
  }
  return { linked, copied, symlinked };
}

/**
 * @param {{
 *   rootDir?: string,
 *   version?: string,
 *   arch?: string,
 *   serverDir?: string,
 *   gitDir?: string,
 *   helperPath?: string,
 *   artifactOutDir?: string,
 *   log?: (message: string) => void,
 *   deps?: {
 *     packTree?: (srcDir: string, archivePath: string) => Promise<void>,
 *     sha256File?: (filePath: string) => Promise<string>,
 *     statSize?: (filePath: string) => number,
 *   },
 * }} opts
 */
export async function buildWindowsStandaloneArtifact(opts = {}) {
  const rootDir = path.resolve(opts.rootDir ?? ROOT);
  const version = opts.version ?? readProductVersion(rootDir);
  const arch = opts.arch ?? STANDALONE_ARCH;
  const names = standaloneArtifactNames(version, arch);
  const serverDir = path.resolve(opts.serverDir ?? path.join(rootDir, "dist-server", `win-${arch}`));
  const gitDir = path.resolve(opts.gitDir ?? path.join(rootDir, "vendor", "mingit"));
  const helperPath = path.resolve(
    opts.helperPath ?? path.join(rootDir, "dist-sandbox", `win-${arch}`, "hana-win-sandbox.exe"),
  );
  const artifactOutDir = path.resolve(opts.artifactOutDir ?? path.join(rootDir, "dist-standalone"));
  const log = opts.log ?? console.log;
  const {
    packTree = ustar.packTree,
    sha256File = activation.sha256File,
    statSize = (filePath) => fs.statSync(filePath).size,
  } = opts.deps ?? {};

  assertArtifactOutputIsSeparate({ rootDir, serverDir, artifactOutDir });
  const archivePath = path.join(artifactOutDir, names.archiveName);
  const manifestPath = path.join(artifactOutDir, names.manifestName);
  const legacySignaturePath = `${manifestPath}.sig`;
  const createdOutputs = [archivePath, manifestPath];

  // ── Cache lookup (must happen BEFORE the rmSync below; on hit we want
  //    to reuse the existing outputs rather than blow them away and rebuild
  //    the same content). Inputs are validated after the cache check so a
  //    cache hit can only occur when last build's inputs are still present
  //    on disk and structurally unchanged. ──────────────────────────────
  const cacheDir = path.join(rootDir, ".cache", "build-standalone");
  let cacheMarker = null;
  try {
    const cacheKey = hashStandaloneInputs({ version, serverDir, gitDir, helperPath });
    cacheMarker = readStandaloneCacheMarker(cacheDir, cacheKey);
  } catch {
    // Hash / IO failure is non-fatal; fall through to rebuild.
    cacheMarker = null;
  }

  if (
    cacheMarker
    && cacheMarker.archiveName === names.archiveName
    && fs.existsSync(archivePath)
    && fs.existsSync(manifestPath)
  ) {
    log(`[standalone] cache hit, reusing ${names.archiveName} (sha256=${cacheMarker.sha256.slice(0, 12)}...)`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { archivePath, manifestPath, manifest };
  }

  // Remove this version's previous result before validating inputs. Otherwise a
  // failed rebuild (missing helper/runtime) can leave a stale but still
  // valid-looking release set behind for a later verify/upload step. Also
  // remove the detached signature produced by the short-lived signed format so
  // local output directories cannot accidentally retain that obsolete asset.
  for (const output of [...createdOutputs, legacySignaturePath]) fs.rmSync(output, { force: true });

  assertServerTree(serverDir);
  assertDirectory(gitDir, "MinGit runtime");
  try {
    assertRuntimeComplete(gitDir);
  } catch (error) {
    throw new Error(`[standalone] MinGit runtime is incomplete; refusing to publish\n${error.message}`);
  }
  assertFile(helperPath, "Windows sandbox helper");

  fs.mkdirSync(artifactOutDir, { recursive: true });

  // Stage on the SAME volume as serverDir so hardlinkCopySync below can take
  // the fast O(1) path. os.tmpdir() in dev is on C: while serverDir lives on
  // D:, which silently demotes every hardlink to a full copyFileSync.
  const stagingRoot = path.join(rootDir, ".cache", "hana-standalone-staging");
  fs.mkdirSync(stagingRoot, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(stagingRoot, "stage-"));
  const layoutRoot = path.join(stagingDir, STANDALONE_LAYOUT_ROOT);

  try {
    fs.mkdirSync(layoutRoot, { recursive: true });
    // Hardlink both trees into the staging dir. On Windows same-volume NTFS
    // hardlinks make this ~O(files) instead of ~O(total bytes). Falls back
    // per-file to copyFileSync when linkSync fails (cross-volume / locked
    // down dev machines), so behavior is no worse than the previous cpSync.
    const serverStats = hardlinkCopySync(serverDir, path.join(layoutRoot, "server"), log);
    const gitStats = hardlinkCopySync(gitDir, path.join(layoutRoot, "git"), log);
    log(`[standalone] staging hardlinks: server ${serverStats.linked} linked / ${serverStats.copied} copied; git ${gitStats.linked} linked / ${gitStats.copied} copied; ${serverStats.symlinked + gitStats.symlinked} symlinks`);
    const stagedHelper = path.join(layoutRoot, "sandbox", "windows", "hana-win-sandbox.exe");
    fs.mkdirSync(path.dirname(stagedHelper), { recursive: true });
    fs.copyFileSync(helperPath, stagedHelper);

    const wrappers = standaloneWrapperContents();
    fs.writeFileSync(path.join(layoutRoot, "hana.cmd"), wrappers.hana, "utf8");
    fs.writeFileSync(path.join(layoutRoot, "hana-server.cmd"), wrappers.server, "utf8");

    await packTree(stagingDir, archivePath);
    const sha256 = await sha256File(archivePath);
    const size = statSize(archivePath);
    const manifest = {
      schema: 1,
      kind: "hana-core-standalone",
      version,
      platform: STANDALONE_PLATFORM,
      arch,
      createdAt: new Date().toISOString(),
      archive: { path: names.archiveName, sha256, size },
      layout: {
        root: STANDALONE_LAYOUT_ROOT,
        server: `${STANDALONE_LAYOUT_ROOT}/server`,
        git: `${STANDALONE_LAYOUT_ROOT}/git`,
        sandboxHelper: `${STANDALONE_LAYOUT_ROOT}/sandbox/windows/hana-win-sandbox.exe`,
      },
      runtime: { minGitVersion: MINGIT_VERSION },
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    log(`[standalone] packed ${names.archiveName} with SHA-256 manifest -> ${artifactOutDir}`);

    // ── Cache write (best-effort). Keyed on the same input hash used for
    //    lookup above; on the next build with unchanged inputs this marker
    //    short-circuits the entire cpSync + packTree + sha256 path. ─────
    try {
      const cacheKey = hashStandaloneInputs({ version, serverDir, gitDir, helperPath });
      writeStandaloneCacheMarker(cacheDir, cacheKey, {
        archiveName: names.archiveName,
        version,
        sha256,
        size,
        createdAt: manifest.createdAt,
      });
    } catch {
      // Cache write failure is non-fatal — the artifact is already on disk.
    }

    return { archivePath, manifestPath, manifest };
  } catch (error) {
    for (const output of createdOutputs) fs.rmSync(output, { force: true });
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function main() {
  const arch = process.argv[2] ?? STANDALONE_ARCH;
  if (process.argv.length > 3 || arch.startsWith("--")) {
    throw new Error("[standalone] usage: node scripts/build-standalone-server-artifact.mjs [x64]");
  }
  await buildWindowsStandaloneArtifact({ arch });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
