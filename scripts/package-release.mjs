import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseImportResult } from '../src/catalog.ts';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src-tauri/target/release');
const executable = process.env.STORY_TRACKER_RELEASE_EXE;
if (!executable) throw new Error('Use npm run desktop:release to build the portable release');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dest = path.join(root, 'dist-release', 'story-tracker-' + version + '-' + stamp);
function publicWarnings(output) {
  switch (output.catalog.game.id) {
    case 'arknights': return [];
    case 'girls-frontline': {
      const date = output.warnings.join('\n').match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (!date) throw new Error('Missing Girls Frontline data date');
      return [
        '剧情目录整理于 ' + date + '；目录内容不代表任何服务器当前开放进度。',
        output.warnings.find(s => s.startsWith('中文名称对照核对于 ')) ?? '未核实的中文名称保留 IOP 原名。',
        '日期采用国服章节／活动首次开放日；夜战使用独立开放日。',
      ];
    }
    case 'girls-frontline-2': return [
      '日期采用国服首次开放日。',
      '战前与战后剧情合并为一条记录；第0章按一个剧情记录。',
      '部分来源视频合并了多个关卡，多个剧情项可能指向同一视频片段。',
    ];
    case 'blue-archive': {
      const report = JSON.parse(fs.readFileSync(path.join(source, 'export/ba_story_report.json'), 'utf8'));
      const { rows } = JSON.parse(fs.readFileSync(path.join(source, 'export/ba_story_catalog.json'), 'utf8'));
      if (rows.length !== report.total) throw new Error('Blue Archive title report mismatch');
      const verified = type => rows.filter(r => r.type === type && r.titleLanguage.startsWith('zh-CN')).length;
      const pending = rows.filter(r => r.titleLanguage.startsWith('zh-TW')).length;
      const favors = rows.filter(r => r.type === '羁绊').length;
      return [
        '剧情目录包含国服尚未开放的内容，不代表国服当前开放进度。',
        '活动日期采用国服首次开放日：已核实 ' + report.eventDates.filled + '/' + report.eventDates.total +
          ' 个活动，其余日期留空。',
        '主线日期采用国服各批次首次开放日：已核实 ' + report.mainDates.filled + '/' + report.mainDates.total +
          ' 条剧情，其余日期留空；其他类型暂不记录日期。',
        '已对照简中来源的剧情标题：主线 ' + verified('主线') + ' 条、活动 ' + verified('活动') +
          ' 条、特殊作战 ' + verified('特殊作战') + ' 条；其余 ' + pending + ' 条为繁中转简体，尚未逐条核对。',
        '羁绊目录中的角色姓名优先采用已有简中对照；缺少独立对照的换装版沿用同一角色的简中姓名，换装描述保留来源译名。' +
          '羁绊剧情标题共 ' + favors + ' 条，仍为繁中转简体，未逐条校对；缺少可靠姓名对照的角色保留来源译名。',
        '不计入独立小游戏剧情与网页活动。',
      ];
    }
    default: throw new Error('Unexpected release game');
  }
}
const files = ['arknights.json', 'girls-frontline.json', 'girls-frontline-2.json', 'blue-archive.json'];
function checkPrivacy(bytes, label) {
  const texts = [bytes.toString('utf8'), bytes.toString('utf16le'), bytes.subarray(1).toString('utf16le')];
  const privateRoots = [root, process.env.USERPROFILE].filter(Boolean)
    .flatMap(p => [p, p.replaceAll('\\', '/')]);
  if (texts.some(text => privateRoots.some(p => text.toLowerCase().includes(p.toLowerCase())) ||
      /[a-z]:[\\/]Users[\\/]|\/home\/[^/\\\\\s]+|local\.[a-z0-9_-]+\.story-tracker|%APPDATA%/i.test(text))) {
    throw new Error(label + ': personal path or old user-data address found; release aborted');
  }
}
checkPrivacy(fs.readFileSync(executable), 'Executable');
const releaseDocuments = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'DATA_LICENSES.md'];
for (const file of releaseDocuments) checkPrivacy(fs.readFileSync(path.join(root, file)), file);
function checkLicenseTree(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Symlink in license directory');
    if (item.isDirectory()) checkLicenseTree(file);
    else checkPrivacy(fs.readFileSync(file), path.relative(root, file));
  }
}
checkLicenseTree(path.join(root, 'licenses'));
const catalogs = files.map(file => {
  const bytes = fs.readFileSync(path.join(source, 'export', file));
  if (bytes.length > 16 * 1024 * 1024) throw new Error(file + ': catalog exceeds size limit');
  checkPrivacy(bytes, file);
  const output = parseImportResult(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
  const id = output.catalog.importerId;
  if (!id || !/^[a-z0-9_-]{1,64}$/.test(id)) throw new Error(file + ': invalid importer id');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'importers', id, 'manifest.json'), 'utf8'));
  if (manifest.gameId !== output.catalog.game.id) throw new Error(file + ': mismatched game');
  output.warnings = publicWarnings(output);
  parseImportResult(output);
  return { file, bytes: Buffer.from(JSON.stringify(output, null, 2) + '\n'), manifest: { ...manifest, name: output.catalog.game.title + ' · 本地数据', runtime: 'json', entry: file } };
});
if (new Set(catalogs.map(c => c.manifest.id)).size !== 4) throw new Error('Expected four distinct catalogs');
if (!fs.existsSync(executable)) throw new Error('Build the desktop application first');
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(path.join(dest, 'export'));
fs.mkdirSync(path.join(dest, 'data'));
for (const file of releaseDocuments) fs.copyFileSync(path.join(root, file), path.join(dest, file));
fs.cpSync(path.join(root, 'licenses'), path.join(dest, 'licenses'), { recursive: true });
fs.copyFileSync(executable, path.join(dest, 'story-tracker.exe'));
checkPrivacy(fs.readFileSync(path.join(dest, 'story-tracker.exe')), 'Packaged executable');
for (const { file, bytes, manifest } of catalogs) {
  const dir = path.join(dest, 'importers', manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), bytes);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const seed = JSON.parse(execFileSync('cargo', [
  'run', '--offline', '--locked', '--release', '--no-default-features',
  '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--example', 'seed_catalogs', '--',
  path.join(dest, 'data/story-tracker.sqlite3'),
  ...catalogs.map(c => path.join(dest, 'importers', c.manifest.id, c.file)),
], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
if (seed.games !== catalogs.length || seed.nodes !== catalogs.reduce((sum, c) => sum + JSON.parse(c.bytes.toString('utf8')).catalog.nodes.length, 0))
  throw new Error('Initial database does not match bundled catalogs');
checkPrivacy(fs.readFileSync(path.join(dest, 'data/story-tracker.sqlite3')), 'Initial catalog database');

// ZIP timestamps must fall within the DOS date range. Normalize upstream files only in the package.
function normalizeZipDates(directory) {
  const now = new Date();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeZipDates(file);
    const stat = fs.statSync(file);
    if (stat.mtime.getFullYear() < 1980 || stat.mtime.getFullYear() > 2107) fs.utimesSync(file, now, now);
  }
}
normalizeZipDates(dest);
console.log(dest);
