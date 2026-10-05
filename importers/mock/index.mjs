import { readFile } from 'node:fs/promises';

try {
  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  catalog.importerId = 'mock';
  process.stdout.write(JSON.stringify({ apiVersion: 1, catalog, warnings: [] }));
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
