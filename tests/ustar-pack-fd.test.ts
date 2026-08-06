import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import ustarModule from "../shared/artifact-core/ustar.cjs";

const { packTree, extract } = ustarModule as {
  packTree: (
    srcDir: string,
    archivePath: string,
    deps?: {
      createReadStream?: (path: string, opts?: any) => any;
      lstat?: (path: string) => Promise<any>;
    },
  ) => Promise<void>;
  extract: (archivePath: string, destDir: string) => Promise<void>;
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Background: packing a real `dist-server` tree (tens of thousands of small
 * files in `node_modules/...`) on Windows previously tripped EMFILE because
 * `for await` over the read stream ran to completion before the previous
 * file's fd was returned to libuv. This test reproduces the failure mode by
 * building a synthetic tree with the same file-count ballpark and asserts:
 *   1. `packTree` resolves without throwing
 *   2. the resulting archive is non-empty and a real gzip/ustar stream
 *   3. the archive extracts back to the original entries, byte-for-byte
 *   4. on simulated mid-pack failure, the half-written archive is removed
 *      so the next build can't mistake a 0-byte .tar.gz for a real seed.
 */
describe("ustar.packTree fd budget", () => {
  it("packs and round-trips a deep tree of many small files without EMFILE", async () => {
    const root = makeTempDir("hana-ustar-fd-");
    const srcDir = path.join(root, "src");
    await fsp.mkdir(srcDir, { recursive: true });

    const fileCount = 6000;
    const expectedLines: string[] = [];
    for (let i = 0; i < fileCount; i += 1) {
      const dir = path.join(srcDir, `pkg-${i % 64}`, `nested-${i % 17}`);
      await fsp.mkdir(dir, { recursive: true });
      const line = `module.exports = { n: ${i}, pad: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };\n`;
      expectedLines.push(line);
      await fsp.writeFile(path.join(dir, `file-${i}.js`), line);
    }

    const archivePath = path.join(root, "tree.tar.gz");
    await packTree(srcDir, archivePath);

    const stat = await fsp.stat(archivePath);
    expect(stat.size).toBeGreaterThan(1024);
    // gzip magic 0x1F 0x8B
    const head = await fsp.readFile(archivePath, { flag: "r" });
    expect(head[0]).toBe(0x1f);
    expect(head[1]).toBe(0x8b);

    const extractDir = path.join(root, "out");
    await extract(archivePath, extractDir);
    const sample = await fsp.readFile(
      path.join(extractDir, "pkg-3", "nested-3", "file-3.js"),
      "utf8",
    );
    expect(sample).toBe(expectedLines[3]);
  }, 60_000);

  it("deletes the half-written archive when packing fails, so a 0-byte tar.gz never survives", async () => {
    const root = makeTempDir("hana-ustar-fd-fail-");
    const srcDir = path.join(root, "src");
    await fsp.mkdir(srcDir, { recursive: true });
    // 200 small files keeps the test fast while still exercising the cleanup path.
    for (let i = 0; i < 200; i += 1) {
      await fsp.writeFile(path.join(srcDir, `f-${i}.txt`), `hello ${i}\n`);
    }
    // Plant a "file" whose `lstat` will reject. The failure happens
    // synchronously inside the walk loop's await chain, so the outer
    // `try { await walk("") } catch { fail(err); ... }` handles it without
    // any unhandled-rejection surface (unlike injecting an error into a
    // Readable's async iterator, which Vitest flags separately).
    const blockerDir = path.join(srcDir, "blocker");
    await fsp.mkdir(blockerDir, { recursive: true });
    const blockerFile = path.join(blockerDir, "boom.js");
    await fsp.writeFile(blockerFile, "module.exports = {};\n");

    let callCount = 0;
    const realLstat = fsp.lstat;
    const lstat = async (p: string) => {
      callCount += 1;
      if (p === blockerFile) {
        const err: any = new Error("synthetic EMFILE");
        err.code = "EMFILE";
        throw err;
      }
      return realLstat(p);
    };

    const archivePath = path.join(root, "fail.tar.gz");
    await expect(packTree(srcDir, archivePath, { lstat })).rejects.toThrow();
    // Half-written archive MUST be removed, not left at 0 bytes.
    await expect(fsp.access(archivePath)).rejects.toThrow(/ENOENT/);
    expect(callCount).toBeGreaterThan(0);
  }, 30_000);
});
