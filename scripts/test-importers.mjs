import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tests = globSync('importers/*/*.test.mjs');
if (tests.length) {
  const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
