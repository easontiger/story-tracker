import { useState } from 'react';
import { createAppendCatalog } from './append';
import type { Snapshot, StoryCatalog } from './types';

export function AppendForm({ snapshot, initialGameId, disabled, onPreview }: {
  snapshot: Snapshot; initialGameId: string | null; disabled: boolean;
  onPreview: (makeCatalog: () => StoryCatalog) => void;
}) {
  const firstGameId = initialGameId ?? snapshot.games[0]?.id ?? '';
  const [gameId, setGameId] = useState(firstGameId);
  const [lineId, setLineId] = useState(snapshot.storyLines.find(line => line.gameId === firstGameId)?.id ?? '');
  const [parentId, setParentId] = useState('');
  const [title, setTitle] = useState('');
  const [releasedAt, setReleasedAt] = useState('');
  const [stories, setStories] = useState('');
  const lines = snapshot.storyLines.filter(line => line.gameId === gameId);
  const nodes = snapshot.nodes.filter(node => node.active && node.gameId === gameId && node.storyLineId === lineId);
  const parents = new Set(nodes.map(node => node.parentId));
  function path(id: string): string {
    const titles: string[] = [];
    const seen = new Set<string>();
    let node = nodes.find(item => item.id === id);
    while (node && !seen.has(node.id)) {
      seen.add(node.id); titles.unshift(node.title);
      node = nodes.find(item => item.id === node!.parentId);
    }
    return titles.join(' / ');
  }
  return <form className="append-form" onSubmit={event => {
    event.preventDefault();
    onPreview(() => createAppendCatalog(snapshot, { gameId, lineId, parentId: parentId || null,
      title, stories, releasedAt }, crypto.randomUUID()));
  }}>
    <fieldset disabled={disabled}>
      <legend>手动新增活动</legend>
      <label>游戏<select value={gameId} onChange={event => {
        const id = event.target.value; setGameId(id);
        setLineId(snapshot.storyLines.find(line => line.gameId === id)?.id ?? ''); setParentId('');
      }}>{snapshot.games.map(game => <option key={game.id} value={game.id}>{game.title}</option>)}</select></label>
      <label>分类<select value={lineId} onChange={event => { setLineId(event.target.value); setParentId(''); }}>
        {lines.map(line => <option key={line.id} value={line.id}>{line.title}</option>)}
      </select></label>
      <label>放入目录<select value={parentId} onChange={event => setParentId(event.target.value)}>
        <option value="">分类下直接新增</option>
        {nodes.filter(node => parents.has(node.id)).map(node => <option key={node.id} value={node.id}>{path(node.id)}</option>)}
      </select></label>
      <label>活动 / 章节名称<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>开放日期（可不填）<input type="text" placeholder="YYYY-MM-DD，例如 2026-10-04" maxLength={10} value={releasedAt} onChange={event => setReleasedAt(event.target.value)} /></label>
      <label>剧情列表（每行一条）<textarea required rows={8} value={stories} onChange={event => setStories(event.target.value)} /></label>
      <button type="submit">生成追加预览</button>
    </fieldset>
  </form>;
}
