/**
 * timed-step.mjs — 给 dist:win 这种长流水线用的"耗时打点"包装器。
 *
 * 用法（package.json 的 npm script 里）：
 *   node scripts/timed-step.mjs <npm-script-name> [args...]
 *
 * 行为：
 *   - 透传 `npm run <name> [args...]`，stdio 继承（子进程输出原样显示）
 *   - 子进程结束后打印 `[timing]` 起止时间 + 耗时 + 退出状态
 *   - 子进程退出码透传（成功 0，失败非 0），用 && 串联时下流会正确中止
 *   - 失败也打印耗时（try/catch/finally），方便定位在哪一步崩了
 *
 * 输出格式（前后各一行，方便 grep `[timing]` 拉整条流水线的耗时分布）：
 *   [timing] >>> build:server  (start 2026-08-06T17:30:12.123Z)
 *   ... 子进程输出 ...
 *   [timing] <<< build:server  312.40s  [ok]
 *   [timing] <<< build:server  12.04s   [fail(exit=1)]
 */
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const scriptName = args[0];

if (!scriptName) {
  console.error('[timing] usage: node scripts/timed-step.mjs <npm-script> [args...]');
  process.exit(2);
}

const forwardedArgs = args.slice(1).map(a => /\s/.test(a) ? `"${a}"` : a).join(' ');
const npmCmd = `npm run ${scriptName}${forwardedArgs ? ` -- ${forwardedArgs}` : ''}`;

const startMs = Date.now();
const startIso = new Date(startMs).toISOString();
console.log(`[timing] >>> ${scriptName}  (start ${startIso})`);

let exitCode = 0;
try {
  execSync(npmCmd, { stdio: 'inherit' });
} catch (err) {
  exitCode = typeof err.status === 'number' ? err.status : 1;
} finally {
  const elapsedMs = Date.now() - startMs;
  const elapsedS = (elapsedMs / 1000).toFixed(2);
  const status = exitCode === 0 ? 'ok' : `fail(exit=${exitCode})`;
  console.log(`[timing] <<< ${scriptName}  ${elapsedS}s  [${status}]`);
}

if (exitCode !== 0) process.exit(exitCode);