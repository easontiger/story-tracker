import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const identifier = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).identifier;
const namespace = identifier.split('.').slice(0, -1).join('.');
const username = path.basename(process.env.USERPROFILE || os.homedir());
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const finalDest = path.join(root, 'dist-release', 'story-tracker-source-' + version + '-' + stamp);
const dest = finalDest + '.partial';
const rootFiles = new Set(['.gitignore', 'README.md', 'LICENSE', 'DATA_LICENSES.md', 'THIRD_PARTY_NOTICES.md',
  'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts']);
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'))]
  .filter(file => file && (rootFiles.has(file) || /^(src|tests|scripts|importers|licenses|src-tauri)\//.test(file)));
function allowed(file) {
  return !/(^|\/)(\.git|\.tools|node_modules|target|gen|\.agents|\.codex)(\/|$)/.test(file)
    && !/(^|\/)(AGENTS\.md|agents\.md|1\.md|\.env(?:\..*)?|config\.json)$/.test(file)
    && !/\.(db|sqlite3?|pdb|log)(-wal|-shm)?$/i.test(file);
}
const included = files.filter(allowed);
const secrets = /github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}/;
const privateRoots = [root, process.env.USERPROFILE].filter(Boolean).flatMap(p => [p, p.replaceAll('\\', '/')]);
let changed = 0;
for (const file of included) {
  const source = path.join(root, file);
  if (!fs.statSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw new Error('Unexpected source entry: ' + file);
  let bytes = fs.readFileSync(source);
  if (!/\.ico$/i.test(file)) {
    let text = bytes.toString('utf8');
    const original = text;
    if (!file.startsWith('licenses/')) {
      text = text.replaceAll(namespace + '.story-tracker', 'local.story-tracker');
      if (file === 'scripts/package-release.mjs') {
        text = text.replaceAll('\\/home\\/' + username, '\\/home\\/[^/\\\\\\\\\\s]+');
        text = text.replaceAll(namespace.replaceAll('.', '\\.'), 'local\\.[a-z0-9_-]+\\.story-tracker');
      }
      if (file === 'scripts/license-notices.mjs') {
        text = text.replace("import { createHash } from 'node:crypto';",
          "import { createHash } from 'node:crypto';\nimport os from 'node:os';");
        text = text.replace("const output = path.join(root, 'licenses');",
          "const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');\nconst output = path.join(root, 'licenses');");
        text = text.replaceAll("path.join(root, '.tools/cargo/bin/cargo.exe')", "'cargo'");
        text = text.replaceAll("env: { ...process.env, CARGO_HOME: path.join(root, '.tools/cargo'), RUSTUP_HOME: path.join(root, '.tools/rustup') }",
          "env: { ...process.env, CARGO_HOME: cargoHome }");
        text = text.replaceAll("path.join(root, '.tools/cargo/bin/rustc.exe')", "'rustc'");
        text = text.replaceAll("env: { ...process.env, RUSTUP_HOME: path.join(root, '.tools/rustup') }", "env: process.env");
        text = text.replace("const toolchain = path.join(root, '.tools/rustup/toolchains/stable-x86_64-pc-windows-msvc/share/doc/rust');",
          "const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim();\nconst toolchain = path.join(sysroot, 'share/doc/rust');");
      }
      if (file === '.gitignore') text += '\n# Local development instructions\n/AGENTS.md\n';
      if (file === 'README.md') text += '\n## 从源码运行\n\n开发环境：Windows x64、Node.js 24、Rust MSVC 工具链、Visual Studio C++ 构建工具和 WebView2 Runtime。\n\n在源码根目录执行：\n\n    npm ci\n    npm run importers:install\n    npm run desktop:dev\n\n前端与导入模块测试使用 `npm test`，数据库测试使用 `npm run test:db`。构建程序使用 `npm run desktop:build`。便携打包需先生成四份导出目录及 BA 校对报告；现成便携包从 Release 下载。\n';
    }
    if (text !== original) changed++;
    if (secrets.test(text)) throw new Error('Possible credential in: ' + file);
    if (privateRoots.some(p => text.toLowerCase().includes(p.toLowerCase()))
      || /[a-z]:[\\/]Users[\\/]/i.test(text) || text.includes('/home/' + username)) throw new Error('Private path or identifier in: ' + file);
    if (!file.startsWith('licenses/') && new RegExp('\\b' + escaped(username) + '\\b', 'i').test(text))
      throw new Error('Local user name in: ' + file);
    if (file.endsWith('.json')) JSON.parse(text);
    bytes = Buffer.from(text);
  }
  const target = path.join(dest, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
if (fs.existsSync(path.join(dest, '.git')) || fs.existsSync(path.join(dest, 'AGENTS.md'))) throw new Error('Internal files found');
for (const file of included.filter(f => f.endsWith('.mjs'))) {
  execFileSync(process.execPath, ['--check', path.join(dest, file)], { cwd: dest, stdio: 'pipe' });
}
for (const file of included.filter(f => f.startsWith('licenses/'))) {
  if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(dest, file))))
    throw new Error('Upstream notice changed: ' + file);
}
console.error('Sanitized source: ' + included.length + ' files, ' + changed + ' text files adjusted; JSON, JavaScript syntax and upstream notices checked');
fs.renameSync(dest, finalDest);
console.log(finalDest);
