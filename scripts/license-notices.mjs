import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const output = path.join(root, 'licenses');
fs.mkdirSync(output, { recursive: true });
const rows = [];
function collect(directory, destination) {
  const copied = [];
  for (const file of fs.readdirSync(directory)) {
    if (!/^(licen[sc]e|copying|notice|copyright|authors)([._-]|$)/i.test(file)) continue;
    const source = path.join(directory, file);
    fs.cpSync(source, path.join(destination, file), { recursive: true });
    copied.push(file);
  }
  return copied;
}
function add(ecosystem, name, version, license, directory, source) {
  const relative = ecosystem + '/' + name.replaceAll('/', '__') + '-' + version;
  const destination = path.join(output, relative);
  fs.mkdirSync(destination, { recursive: true });
  const files = collect(directory, destination);
  rows.push({ ecosystem, name, version, license, relative, source, files });
  return { destination, files };
}
const cargo = JSON.parse(execFileSync('cargo', [
  'metadata', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--format-version', '1',
  '--offline', '--locked', '--filter-platform', 'x86_64-pc-windows-msvc',
], {
  env: { ...process.env, CARGO_HOME: cargoHome },
  encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
}));
const packages = new Map(cargo.packages.map(p => [p.id, p]));
const nodes = new Map(cargo.resolve.nodes.map(n => [n.id, n]));
const visited = new Set();
function visit(id) {
  if (visited.has(id) || packages.get(id).targets.every(t => t.kind.includes('proc-macro'))) return;
  visited.add(id);
  for (const dep of nodes.get(id).deps) if (dep.dep_kinds.some(k => k.kind === null)) visit(dep.pkg);
}
visit(cargo.resolve.root);
for (const id of [...visited].sort()) {
  if (id === cargo.resolve.root) continue;
  const p = packages.get(id);
  if (!p.license && !p.license_file) throw new Error(p.name + ': missing license metadata');
  const directory = path.dirname(p.manifest_path);
  const { destination, files } = add('cargo', p.name, p.version, p.license || 'See license file', directory,
    'https://crates.io/api/v1/crates/' + p.name + '/' + p.version + '/download');
  if (p.license_file && !files.includes(p.license_file)) {
    fs.copyFileSync(path.join(directory, p.license_file), path.join(destination, path.basename(p.license_file)));
    files.push(path.basename(p.license_file));
  }
  for (const file of fs.readdirSync(destination)) {
    if (/^(licen[sc]e|copying|notice)/i.test(file) && !files.includes(file)) files.push(file);
  }
  if (!files.some(f => /^(licen[sc]e|copying)/i.test(f)) && p.license === 'MPL-2.0') {
    const donor = cargo.packages.find(x => x.name === 'cssparser');
    fs.copyFileSync(path.join(path.dirname(donor.manifest_path), 'LICENSE'), path.join(destination, 'LICENSE-MPL-2.0'));
    files.push('LICENSE-MPL-2.0');
    const header = fs.readFileSync(path.join(directory, 'lib.rs'), 'utf8').split('*/')[0] + '*/\n';
    fs.writeFileSync(path.join(destination, 'NOTICE-source-header.txt'), header);
    files.push('NOTICE-source-header.txt');
  }
  if (!files.some(f => /^(licen[sc]e|copying)/i.test(f))) {
    const vcs = JSON.parse(fs.readFileSync(path.join(directory, '.cargo_vcs_info.json'), 'utf8'));
    const repo = p.repository?.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
    if (!repo || repo.startsWith('http')) throw new Error(p.name + ': cannot find upstream license');
    const candidates = ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];
    const found = await Promise.all(candidates.map(async file => {
      const url = 'https://raw.githubusercontent.com/' + repo + '/' + vcs.git.sha1 + '/' + file;
      const target = path.join(destination, file);
      if (fs.existsSync(target)) return file;
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      return file;
    }));
    files.push(...found.filter(Boolean));
    if (!files.some(f => /^(licen[sc]e|copying)/i.test(f))) throw new Error(p.name + ': upstream license missing');
  }
}
const npmVisited = new Set();
function npmVisit(name) {
  if (npmVisited.has(name)) return;
  npmVisited.add(name);
  const directory = path.join(root, 'node_modules', name);
  const p = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const { files } = add('npm', name, p.version, p.license, directory,
    'https://registry.npmjs.org/' + name + '/-/' + name.split('/').at(-1) + '-' + p.version + '.tgz');
  if (!files.length) throw new Error(name + ': missing license text');
  for (const dependency of Object.keys(p.dependencies || {})) npmVisit(dependency);
}
for (const name of Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies)) npmVisit(name);
const rustc = execFileSync('rustc', ['--version'],
  { env: process.env, encoding: 'utf8' }).trim();
const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
const toolchain = path.join(sysroot, 'share/doc/rust');
fs.cpSync(path.join(toolchain, 'licenses'), path.join(output, 'rust/licenses'), { recursive: true });
fs.copyFileSync(path.join(toolchain, 'COPYRIGHT-library.html'), path.join(output, 'rust/COPYRIGHT-library.html'));
const sdkInfo = JSON.parse(fs.readFileSync(path.join(output, 'microsoft-webview2-sdk-1.0.3800.47/SOURCE.json'), 'utf8'));
const bindings = cargo.packages.find(p => p.name === 'webview2-com-sys');
if (bindings.version !== sdkInfo.bindingsVersion || createHash('sha256').update(fs.readFileSync(path.join(path.dirname(bindings.manifest_path), 'x64/WebView2LoaderStatic.lib'))).digest('hex') !== sdkInfo.staticLoaderSha256) throw new Error('WebView2 SDK changed; update its license and source record');
const table = rows.sort((a,b) => (a.ecosystem + a.name).localeCompare(b.ecosystem + b.name)).map(p =>
  '| ' + p.ecosystem + ' / ' + p.name + ' | ' + p.version + ' | ' + p.license + ' | ' +
  p.files.map(f => '[' + f + '](licenses/' + p.relative + '/' + f + ')').join('、') +
  ' | [对应版本源码](' + p.source + ') |').join('\n');
const text = '# 第三方软件声明\n\n' +
  '以下组件保留各自的版权和许可证。本项目未修改这些依赖的源码。\n\n' +
  '清单包含 Windows x64 锁定依赖中的 Rust 普通依赖及前端运行依赖。许可原文随包保存在 licenses/，对应版本源码见表中链接。\n\n' +
  'MPL-2.0 组件的源码继续适用 MPL-2.0，其对应版本源码可通过表中的链接获取。\n\n' +
  'Rust 标准库：' + rustc + '。随附 [标准库版权清单](licenses/rust/COPYRIGHT-library.html) 及 licenses/rust/licenses/ 中的许可文本。\n\n' +
  'SQLite 引擎代码属于[公有领域](https://sqlite.org/copyright.html)，Rust 包装层的许可见下表。\n\n' +
  '程序静态链接 Microsoft WebView2 SDK 1.0.3800.47 的 Loader，随附 [SDK 许可证](licenses/microsoft-webview2-sdk-1.0.3800.47/LICENSE.txt)及[原始 SDK 包链接](https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3800.47/microsoft.web.webview2.1.0.3800.47.nupkg)。WebView2 Runtime 由用户另行安装。\n\n' +
  '| 组件 | 版本 | 上游许可声明 | 随附原文 | 源码 |\n| --- | --- | --- | --- | --- |\n' + table + '\n';
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), text);
console.log('Third-party notices: ' + rows.length + ' dependencies; ' + rustc);
