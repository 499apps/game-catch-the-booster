// Local CI: typecheck + lint + unit tests in parallel, then build, then Playwright e2e.
// Prints a wall-clock summary per stage. Cross-platform (Windows host).
import { spawn } from 'node:child_process';

const stages = [
  {
    name: 'typecheck + lint + unit (parallel)',
    cmd: 'pnpm',
    args: [
      'exec',
      'concurrently',
      '--kill-others-on-fail',
      '--names',
      'tsc,lint,unit',
      '"pnpm run typecheck"',
      '"pnpm run lint"',
      '"pnpm run test"',
    ],
  },
  { name: 'build', cmd: 'pnpm', args: ['run', 'build'] },
  { name: 'e2e (playwright)', cmd: 'pnpm', args: ['exec', 'playwright', 'test', '--workers=50%'] },
];

function run(stage) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // shell: true so quoted concurrently arguments and pnpm.cmd resolve on Windows too.
    const child = spawn(stage.cmd, stage.args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) => resolve({ name: stage.name, code: code ?? 1, ms: Date.now() - t0 }));
  });
}

const results = [];
const tAll = Date.now();
let failed = false;
for (const stage of stages) {
  console.log(`\n=== ${stage.name} ===`);
  const r = await run(stage);
  results.push(r);
  if (r.code !== 0) {
    failed = true;
    break;
  }
}
console.log('\n=== ci:local summary ===');
for (const r of results) {
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${(r.ms / 1000).toFixed(1).padStart(7)} s  ${r.name}`);
}
console.log(`TOTAL ${((Date.now() - tAll) / 1000).toFixed(1).padStart(7)} s`);
process.exit(failed ? 1 : 0);
