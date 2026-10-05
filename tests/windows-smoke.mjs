import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const exe = process.env.STORY_TRACKER_SMOKE_EXE;
const dataDir = process.env.STORY_TRACKER_SMOKE_DATA_DIR;
if (!exe || !dataDir || !dataDir.includes('story-tracker-smoke-') || existsSync(dataDir)) {
  throw new Error('An isolated, unused smoke-test data directory is required');
}
const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const moduleRoot = join(dirname(exe), 'importers');
const mockFile = join(moduleRoot, 'mock', 'catalog.json');
const originalMock = readFileSync(mockFile, 'utf8');
const fixture = JSON.parse(originalMock);
const hotplugDir = join(moduleRoot, 'hotplug-smoke');
if (existsSync(hotplugDir)) throw new Error('Hotplug smoke module directory is already in use');
const prtsConfig = join(moduleRoot, 'prts', 'config.json');
const originalPrtsConfig = existsSync(prtsConfig) ? readFileSync(prtsConfig, 'utf8') : null;
const webviewDir = join(process.env.LOCALAPPDATA, basename(dataDir));
if (existsSync(webviewDir)) throw new Error('The smoke-test WebView directory must be unused');
let current = fixture;
let child;
let browser;
let page;
const errors = [];

async function open() {
  child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, STORY_TRACKER_IMPORTERS_DIR: moduleRoot } });
  child.on('error', error => errors.push(String(error)));
  const deadline = Date.now() + 20000;
  while (true) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }); break; }
    catch (error) {
      if (Date.now() > deadline || child.exitCode !== null) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page');
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(String(error)));
  await page.getByRole('button', { name: '导入 / 更新', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('header button:last-child').disabled);
}

async function close() {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await once(killer, 'exit');
    await exited;
  }
  if (browser) { await browser.close().catch(() => {}); browser = undefined; }
  child = undefined;
}

async function home() {
  const back = page.getByRole('button', { name: '返回首页', exact: true });
  if (await back.count()) await back.click();
}
async function detail() { await page.getByRole('button', { name: /示例游戏.*watched/ }).click(); }
async function saved() { await page.getByRole('status').filter({ hasText: '已保存' }).waitFor(); }
async function updatePreview() {
  writeFileSync(mockFile, JSON.stringify(current), 'utf8');
  await page.getByRole('button', { name: '导入 / 更新', exact: true }).click();
  await page.getByRole('combobox', { name: '导入模块', exact: true }).selectOption('mock');
  await page.getByRole('button', { name: '生成更新预览', exact: true }).click();
  await page.getByRole('heading', { name: '更新预览', exact: true }).waitFor();
}
async function confirm() {
  await page.getByRole('button', { name: '确认更新', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '目录已更新' }).waitFor();
}

try {
  await open();
  await page.getByText('尚未添加游戏', { exact: true }).waitFor();
  await updatePreview();
  await page.getByText(/9 个节点新增/).waitFor();
  await close();
  await open();
  await page.getByText('尚未添加游戏', { exact: true }).waitFor();
  await updatePreview();
  await confirm();
  await home();
  await page.getByRole('button', { name: /0 \/ 7 watched/ }).waitFor();
  await detail();
  const dbPath = join(dataDir, 'story-tracker.sqlite3');
  assert.ok(existsSync(dbPath), 'The desktop application must use the isolated test database');
  const failedWriteDb = new DatabaseSync(dbPath);
  failedWriteDb.exec("CREATE TRIGGER smoke_fail BEFORE INSERT ON watched_stages BEGIN SELECT RAISE(ABORT, 'Simulated database write failure'); END;");
  failedWriteDb.close();
  await page.getByRole('checkbox', { name: '1-1 相遇', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Simulated database write failure' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '1-1 相遇', exact: true }).isChecked(), false);
  const recoveredDb = new DatabaseSync(dbPath);
  recoveredDb.exec('DROP TRIGGER smoke_fail');
  recoveredDb.close();
  await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).check();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: '1-1 相遇', exact: true }).isChecked(), false);
  await close();
  await open();
  await page.getByRole('button', { name: /1 \/ 7 watched/ }).waitFor();
  await detail();
  assert.equal(await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '全部已看', exact: true }).first().click();
  await saved();
  assert.equal(await page.getByRole('checkbox').filter({ visible: true }).count(), 7);
  assert.equal(await page.getByRole('checkbox', { name: '1-1 相遇', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Episode 1', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '全部未看', exact: true }).first().click();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).isChecked(), false);
  await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).check();
  await saved();
  current = structuredClone(fixture);
  current.nodes.push({ sourceKey: 'main/ch2', storyLineId: 'main', parentKey: null, title: '第二章', order: 1 });
  current.nodes.push({ sourceKey: 'main/ch2/1', storyLineId: 'main', parentKey: 'main/ch2', title: '2-1 新旅程', order: 0 });
  await updatePreview();
  await page.getByText(/2 个节点新增/).waitFor();
  await confirm();
  await home();
  await page.getByRole('button', { name: /1 \/ 8 watched/ }).waitFor();
  await detail();
  assert.equal(await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '2-1 新旅程', exact: true }).isChecked(), false);
  current.nodes = current.nodes.filter(node => node.sourceKey !== 'main/ch1/4');
  await updatePreview();
  await page.getByRole('heading', { name: /Orphaned progress/ }).waitFor();
  await confirm();
  await home();
  await page.getByRole('heading', { name: /Orphaned progress/ }).waitFor();
  current.nodes.push({ sourceKey: 'main/ch1/4', storyLineId: 'main', parentKey: 'main/ch1', title: '1-4 归途', order: 3 });
  await updatePreview();
  await confirm();
  await home();
  await detail();
  assert.equal(await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('heading', { name: /Orphaned progress/ }).count(), 0);
  mkdirSync('.tools/screenshots', { recursive: true });
  await page.screenshot({ path: '.tools/screenshots/desktop.png', fullPage: true });
  current.nodes.push(current.nodes[0]);
  writeFileSync(mockFile, JSON.stringify(current), 'utf8');
  await page.getByRole('button', { name: '导入 / 更新', exact: true }).click();
  await page.getByRole('button', { name: '生成更新预览', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button', { name: '确认更新', exact: true }).count(), 0);
  await home();
  await detail();
  assert.equal(await page.getByRole('checkbox', { name: '1-4 归途', exact: true }).isChecked(), true);
  // Install a previously unknown module after the executable is built and running.
  mkdirSync(hotplugDir);
  const hotplug = structuredClone(fixture);
  hotplug.game = { id: 'hotplug-game', title: '独立热插拔测试' };
  writeFileSync(join(hotplugDir, 'manifest.json'), JSON.stringify({ apiVersion: 1, id: 'hotplug-smoke', name: '临时独立模块', gameId: 'hotplug-game', runtime: 'node', entry: 'index.mjs' }));
  writeFileSync(join(hotplugDir, 'index.mjs'), `process.stdout.write(${JSON.stringify(JSON.stringify({ apiVersion: 1, catalog: hotplug, warnings: [] }))});`);
  await page.getByRole('button', { name: '导入 / 更新', exact: true }).click();
  await page.getByRole('button', { name: '刷新模块', exact: true }).click();
  await page.getByRole('combobox', { name: '导入模块', exact: true }).selectOption('hotplug-smoke');
  await page.getByRole('button', { name: '生成更新预览', exact: true }).click();
  await page.getByRole('heading', { name: '更新预览', exact: true }).waitFor();
  await confirm();
  rmSync(hotplugDir, { recursive: true });
  await page.getByRole('button', { name: '刷新模块', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelector('select').options].some(option => option.value === 'hotplug-smoke'));
  await home();
  await page.getByRole('button', { name: /独立热插拔测试.*watched/ }).waitFor();
  await page.getByRole('button', { name: /示例游戏.*1 \/ 8 watched/ }).waitFor();

  // Exercise the real PRTS module against downloaded real API responses when
  // available; otherwise use its live source. No parser runs in the application.
  const storiesFile = join(process.cwd(), '.tools', 'prts', 'stories-api.json');
  const eventsFile = join(process.cwd(), '.tools', 'prts', 'events-api.json');
  if (existsSync(storiesFile) && existsSync(eventsFile)) {
    writeFileSync(prtsConfig, JSON.stringify({ stories: storiesFile, events: eventsFile }));
  }
  await page.getByRole('button', { name: '导入 / 更新', exact: true }).click();
  await page.getByRole('combobox', { name: '导入模块', exact: true }).selectOption('prts');
  await page.getByRole('button', { name: '生成更新预览', exact: true }).click();
  await page.getByRole('heading', { name: '更新预览', exact: true }).waitFor({ timeout: 75000 });
  await confirm();
  await home();
  await page.getByRole('button', { name: /明日方舟.*watched/ }).click();
  const firstStory = page.getByRole('checkbox', { name: '0-1 坍塌 行动前', exact: true });
  await firstStory.check();
  await saved();
  await page.screenshot({ path: '.tools/screenshots/prts.png', fullPage: true });
  await close();
  await open();
  await page.getByRole('button', { name: /明日方舟.*1 \/ [0-9]+ watched/ }).click();
  assert.equal(await page.getByRole('checkbox', { name: '0-1 坍塌 行动前', exact: true }).isChecked(), true);
  const verifyDb = new DatabaseSync(join(dataDir, 'story-tracker.sqlite3'));
  assert.equal(verifyDb.prepare("SELECT adapter FROM wiki_sources WHERE game_id='arknights'").get().adapter, 'prts');
  assert.ok(verifyDb.prepare("SELECT COUNT(*) AS count FROM story_nodes WHERE game_id='arknights' AND released_at IS NOT NULL").get().count > 0);
  verifyDb.close();
  assert.deepEqual(errors, []);
  console.log('Windows desktop smoke passed: runtime install/removal, PRTS import, release metadata,  import confirmation, failed mark rollback, out-of-order marks, restart, bulk operations, catalog additions, orphan retention/restoration, invalid input.');
} catch (error) {
  mkdirSync('.tools/screenshots', { recursive: true });
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '.tools/screenshots/failure.png', fullPage: true }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => 'Unable to read window'));
  }
  throw error;
} finally {
  await close();
  writeFileSync(mockFile, originalMock, 'utf8');
  if (existsSync(hotplugDir)) rmSync(hotplugDir, { recursive: true });
  if (originalPrtsConfig === null) { if (existsSync(prtsConfig)) rmSync(prtsConfig); }
  else writeFileSync(prtsConfig, originalPrtsConfig, 'utf8');
  // Only remove this run's newly-created, uniquely identified test data.
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  if (existsSync(webviewDir)) rmSync(webviewDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
