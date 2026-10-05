import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseImportResult } from './catalog';
import { AppendForm } from './AppendForm';
import { buildTree, treeStats, sortTreeByDate, buildTimeline, searchTree, type TreeNode } from './tree';
import type { DiffPreview, Snapshot, StoryCatalog, OrphanedProgress, ImportRegistry } from './types';

const kinds = { add: '新增', change: '修改', archive: '归档', restore: '恢复' };
const entities = { game: '游戏', storyLine: '剧情线', node: '节点' };
type WatchFilter = 'all' | 'watched' | 'unwatched';
function matchesWatchFilter(entry: TreeNode, filter: WatchFilter) {
  return filter === 'all' || (filter === 'watched' ? entry.watched > 0 : entry.watched < entry.total);
}

type Pending = { catalog: StoryCatalog; preview: DiffPreview; warnings: string[]; append: boolean };

function Orphans({ records }: { records: OrphanedProgress[] }) {
  if (!records.length) return null;
  return <section className="notice" aria-label="孤立观看记录">
    <h3>Orphaned progress · {records.length} 条记录已保留</h3>
    <ul>{records.map(item => <li key={item.stageId}>
      {item.title} <time>{new Date(item.watchedAt).toLocaleString()}</time>
      <small>{item.reason}</small>
    </li>)}</ul>
  </section>;
}

function Branch({ entry, disabled, onMark, expanded, onExpand, watchFilter, searching, category }: {
  entry: TreeNode;
  category?: string;
  searching: boolean;
  watchFilter: WatchFilter;
  disabled: boolean;
  onMark: (id: string, watched: boolean) => void;
  expanded: Record<string, boolean>;
  onExpand: (id: string, open: boolean) => void;
}) {
  if (!matchesWatchFilter(entry, watchFilter)) return null;
  if (!entry.children.length) return <li className={category ? "leaf timeline-leaf" : "leaf"}>
    {category && <small className="project-category">{category}</small>}
    <label><input type="checkbox" checked={entry.node.watchedAt !== null} disabled={disabled}
      onChange={event => onMark(entry.node.id, event.target.checked)} />
      <span>{entry.node.title}</span>
    </label>
    {entry.node.watchedAt && <time>{new Date(entry.node.watchedAt).toLocaleDateString()}</time>}
  </li>;
  return <li className="branch">
    {category && <small className="project-category">{category}</small>}
    <details open={expanded[entry.node.id] ?? true} onToggle={event => onExpand(entry.node.id, event.currentTarget.open)}>
      <summary><span>{entry.node.title}</span>{entry.node.releasedAt && <time className="release">{entry.node.releasedAt.slice(0, 10)}</time>}<span className="count">{entry.watched} / {entry.total}</span></summary>
      {!searching && <div className="batch">
        <button disabled={disabled || entry.watched === entry.total} onClick={() => onMark(entry.node.id, true)}>全部已看</button>
        <button disabled={disabled || entry.watched === 0} onClick={() => onMark(entry.node.id, false)}>全部未看</button>
      </div>}
      <ul>{entry.children.map(child => <Branch key={child.node.id} entry={child} disabled={disabled} onMark={onMark} expanded={expanded} onExpand={onExpand} watchFilter={watchFilter} searching={searching} />)}</ul>
    </details>
  </li>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [update, setUpdate] = useState(false);
  const [appendMode, setAppendMode] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [registry, setRegistry] = useState<ImportRegistry>({ modules: [], errors: [] });
  const [moduleId, setModuleId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState<Record<string, boolean>>({});
  const searching = searchQuery.trim().length > 0;
  const [watchFilter, setWatchFilter] = useState<WatchFilter>('all');
  const [sortMode, setSortMode] = useState<'category' | 'time' | 'progress'>('category');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    if (!isTauri()) {
      setError('请从 Windows 桌面程序启动 Story Tracker。');
      return;
    }
    Promise.all([invoke<Snapshot>('get_snapshot'), invoke<ImportRegistry>('list_import_modules')]).then(([data, imports]) => {
      if (live) { setSnapshot(data); setRegistry(imports); setModuleId(imports.modules[0]?.id ?? ''); }
    })
      .catch(reason => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  function mark(id: string, watched: boolean) {
    if (!snapshot) return;
    const previous = snapshot;
    const descendants = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const parentId = stack.pop()!;
      for (const node of snapshot.nodes.filter(node => node.parentId === parentId)) {
        descendants.add(node.id);
        stack.push(node.id);
      }
    }
    const parents = new Set(snapshot.nodes.map(node => node.parentId));
    const now = new Date().toISOString();
    void run(async () => {
      setSnapshot({ ...previous, nodes: previous.nodes.map(node => descendants.has(node.id) && !parents.has(node.id)
        ? { ...node, watchedAt: watched ? node.watchedAt ?? now : null } : node) });
      try {
        const data = await invoke<Snapshot>('set_watched', { nodeId: id, watched });
        setSnapshot(data);
        setPending(null);
        setStatus('已保存');
      } catch (reason) {
        setSnapshot(previous);
        throw reason;
      }
    });
  }

  async function prepare(value: unknown, append = false) {
    const result = parseImportResult(value);
    const diff = await invoke<DiffPreview>(append ? 'preview_append_catalog' : 'preview_catalog', { catalog: result.catalog });
    setPending({ catalog: result.catalog, preview: diff, warnings: result.warnings, append });
  }

  function refreshModules() {
    setPending(null);
    void run(async () => {
      const imports = await invoke<ImportRegistry>('list_import_modules');
      setRegistry(imports);
      if (!imports.modules.some(module => module.id === moduleId)) setModuleId(imports.modules[0]?.id ?? '');
    });
  }

  function importJson() {
    setPending(null);
    void run(async () => {
      const value = await invoke<unknown>('import_json');
      if (value === null) return;
      const output = parseImportResult(value);
      output.catalog.importerId ??= 'file';
      await prepare(output, appendMode);
    });
  }

  function preview() {
    setPending(null);
    void run(async () => {
      await prepare(await invoke('import_module', { id: moduleId }));
    });
  }

  function exportJson() {
    if (!pending) return;
    const plan = pending;
    void run(async () => {
      const path = await invoke<string | null>('export_catalog', {
        output: { apiVersion: 1, catalog: plan.catalog, warnings: plan.warnings },
      });
      if (path) setStatus(`已导出：${path}`);
    });
  }

  function confirm() {
    if (!pending) return;
    const plan = pending;
    void run(async () => {
      try {
        const data = await invoke<Snapshot>(plan.append ? 'apply_append_catalog' : 'apply_catalog', { catalog: plan.catalog, expectedRevision: plan.preview.revision });
        setSnapshot(data);
        setPending(null);
        setGameId(plan.catalog.game.id);
        setUpdate(false);
        setStatus(plan.append ? '已追加，观看记录已保留' : '目录已更新，观看记录已保留');
      } catch (reason) {
        setPending(null);
        throw reason;
      }
    });
  }

  function expandBranch(id: string, open: boolean) {
    const setOpen = searching ? setSearchExpanded : setExpanded;
    setOpen(previous => (previous[id] ?? true) === open ? previous : { ...previous, [id]: open });
  }

  function expandAll(open: boolean) {
    if (!snapshot || !gameId) return;
    const nodes = snapshot.nodes.filter(node => node.gameId === gameId);
    const parents = new Set(nodes.map(node => node.parentId));
    const setOpen = searching ? setSearchExpanded : setExpanded;
    setOpen(previous => ({ ...previous, ...Object.fromEntries(nodes.filter(node => parents.has(node.id)).map(node => [node.id, open])) }));
  }

  function goHome() {
    setGameId(null);
    setUpdate(false);
    setPending(null);
    setStatus('');
    setError('');
  }

  const game = snapshot?.games.find(item => item.id === gameId);
  const progressLines = new Set(registry.modules.filter(module => module.gameId === game?.id).flatMap(module => module.progressStoryLines ?? []));
  const storyTrees = snapshot && game ? snapshot.storyLines.filter(line => line.gameId === game.id).map(line => {
    const original = buildTree(snapshot.nodes.filter(node => node.gameId === game.id && node.storyLineId === line.id));
    const tree = sortMode === 'progress' && progressLines.has(line.id) ? original : sortTreeByDate(original);
    return { line, tree: searchTree(tree, searchQuery, watchFilter), stats: treeStats(tree) };
  }) : [];

  const timeline = sortMode === 'time' ? buildTimeline(storyTrees.map(({ line, tree }) => ({ title: line.title, tree }))) : [];

  return <main>
    <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部 ↑</button>
    <header>
      <span className="brand">Story Tracker</span>
      <nav aria-label="主导航">
        {(update || gameId !== null) && <button disabled={busy} onClick={goHome}>返回首页</button>}
        <button disabled={busy || !snapshot?.games.length} onClick={() => { setAppendMode(true); setUpdate(true); setPending(null); setStatus(''); setError(''); }}>追加记录</button>
        <button disabled={busy || !snapshot} onClick={() => { setAppendMode(false); setUpdate(true); setPending(null); setStatus(''); setError(''); const importer = snapshot?.games.find(item => item.id === gameId)?.importerId; if (registry.modules.some(module => module.id === importer)) setModuleId(importer!); }}>导入 / 更新</button>
      </nav>
    </header>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="status" role="status">{busy ? '处理中…' : status}</div>
    {!snapshot && isTauri() && !error && <p>加载中…</p>}
    {snapshot && (update ? <section>
      <h1>{appendMode ? '追加记录' : '数据更新'}</h1>
      {appendMode ? <>
        <div className="toolbar"><span>从文件追加新活动或剧情</span><button disabled={busy} onClick={importJson}>导入增量 JSON</button></div>
        <div hidden={!!pending}><AppendForm snapshot={snapshot} initialGameId={gameId} disabled={busy} onPreview={makeCatalog => { void run(async () => { await prepare(makeCatalog(), true); }); }} /></div>
      </> : <div className="toolbar">
        <label>导入模块 <select aria-label="导入模块" disabled={busy} value={moduleId} onChange={event => { setModuleId(event.target.value); setPending(null); setError(''); }}>
          {!registry.modules.length && <option value="">没有可用模块</option>}
          {registry.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
        </select></label>
        <button disabled={busy} onClick={refreshModules}>刷新模块</button>
        <button disabled={busy || !moduleId} onClick={preview}>生成更新预览</button>
        <button disabled={busy} onClick={importJson}>导入 JSON</button>
      </div>}
      {!appendMode && !!registry.errors.length && <div className="notice">{registry.errors.map(item => <p key={item}>{item}</p>)}</div>}
      {pending && <>
        <h2>{pending.append ? '追加预览' : '更新预览'}</h2>
        <p>{pending.preview.changes.filter(c => c.kind === 'add' && c.entity === 'node').length} 个节点新增 · {pending.preview.changes.filter(c => c.kind === 'change' && c.entity === 'node').length} 个节点修改 · {pending.preview.changes.filter(c => c.kind === 'archive' && c.entity === 'node').length} 个节点归档 · 0 条观看记录删除</p>
        {!!pending.warnings.length && <details className="notice"><summary>{pending.warnings.length} 项数据提示</summary><ul>{pending.warnings.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
        <Orphans records={pending.preview.orphanedProgress} />
        <div className="actions"><button disabled={busy} onClick={exportJson}>导出 JSON</button>
          <button disabled={busy || !pending.preview.changes.length} onClick={confirm}>{pending.append ? '确认追加' : '确认更新'}</button>
          <button disabled={busy} onClick={() => setPending(null)}>取消</button></div>
        {pending.preview.changes.length ? <ul className="diff">{pending.preview.changes.map((change, i) => <li key={i}>
          <strong>{kinds[change.kind]} · {entities[change.entity]}</strong><span>{change.title}</span><small>{change.detail}</small>
        </li>)}</ul> : <p>{pending.append ? '没有新增记录；相同来源编号的记录已存在。' : '目录没有变化。'}</p>}
      </>}
    </section> : game ? <section>
      <h1>{game.title}</h1>
      <div className="actions story-controls">
        <label className="story-search">搜索<input type="search" placeholder="搜索章节、活动或剧情名称" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchExpanded({}); }} /></label>
        <label>排序模式 <select value={sortMode} disabled={busy} onChange={event => setSortMode(event.target.value as 'category' | 'time' | 'progress')}>
          <option value="category">分类内按时间</option>
          <option value="time">全部按时间</option>
          {!!progressLines.size && <option value="progress">主线按进度</option>}
        </select></label>
        <label>观看状态 <select value={watchFilter} disabled={busy} onChange={event => setWatchFilter(event.target.value as WatchFilter)}>
          <option value="all">全部</option>
          <option value="watched">已看</option>
          <option value="unwatched">未看</option>
        </select></label>
        <button disabled={busy} onClick={() => expandAll(false)}>全部收起</button>
        <button disabled={busy} onClick={() => expandAll(true)}>全部展开</button>
      </div>
      {!storyTrees.some(({ tree }) => tree.some(entry => matchesWatchFilter(entry, watchFilter))) && <p>没有符合条件的剧情。</p>}
      {sortMode === 'time' ? <section className="story-line" aria-label="全部按时间">
        <ul className="tree">{timeline.map(({ entry, category }) => <Branch key={entry.node.id} entry={entry} category={category} disabled={busy} onMark={mark} expanded={searching ? searchExpanded : expanded} onExpand={expandBranch} watchFilter={watchFilter} searching={searching} />)}</ul>
      </section> : storyTrees.map(({ line, tree, stats }) => {
        if (!tree.some(entry => matchesWatchFilter(entry, watchFilter))) return null;
        return <section className="story-line" key={line.id}>
          <h2>{line.title}<span className="count">{stats.watched} / {stats.total}</span></h2>
          <ul className="tree">{tree.map(entry => <Branch key={entry.node.id} entry={entry} disabled={busy} onMark={mark} expanded={searching ? searchExpanded : expanded} onExpand={expandBranch} watchFilter={watchFilter} searching={searching} />)}</ul>
        </section>;
      })}
      <Orphans records={snapshot.orphanedProgress.filter(record => record.gameId === game.id)} />
    </section> : <section>
      <h1>游戏</h1>
      {!snapshot.games.length && <div className="empty"><p>尚未添加游戏</p><button disabled={busy} onClick={() => { setAppendMode(false); setUpdate(true); }}>导入游戏</button></div>}
      <div className="games">{snapshot.games.map(item => {
        const stats = treeStats(buildTree(snapshot.nodes.filter(node => node.gameId === item.id)));
        return <button className="game" key={item.id} disabled={busy} onClick={() => { setGameId(item.id); setSortMode('category'); setWatchFilter('all'); setSearchQuery(''); setSearchExpanded({}); setStatus(''); }}>
          <strong>{item.title}</strong><span>{stats.watched} / {stats.total} watched</span>
        </button>;
      })}</div>
      <Orphans records={snapshot.orphanedProgress} />
    </section>)}
  </main>;
}
