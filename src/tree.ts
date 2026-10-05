import type { StoryNode } from './types';

export interface TreeNode {
  node: StoryNode;
  children: TreeNode[];
  watched: number;
  total: number;
}

export function buildTree(nodes: StoryNode[]): TreeNode[] {
  const entries = new Map(nodes.map(node => [node.id, { node, children: [], watched: 0, total: 0 } as TreeNode]));
  const roots: TreeNode[] = [];
  for (const entry of entries.values()) {
    const parent = entry.node.parentId === null ? undefined : entries.get(entry.node.parentId);
    if (entry.node.parentId !== null && !parent) throw new Error('剧情树缺少父节点');
    if (parent) parent.children.push(entry); else roots.push(entry);
  }
  const visiting = new Set<string>();
  const seen = new Set<string>();
  function count(entry: TreeNode) {
    if (visiting.has(entry.node.id)) throw new Error('剧情树存在循环');
    visiting.add(entry.node.id);
    entry.children.sort((a, b) => a.node.order - b.node.order || a.node.sourceKey.localeCompare(b.node.sourceKey));
    if (!entry.children.length) {
      entry.total = 1;
      entry.watched = entry.node.watchedAt === null ? 0 : 1;
    } else {
      entry.children.forEach(count);
      entry.total = entry.children.reduce((sum, child) => sum + child.total, 0);
      entry.watched = entry.children.reduce((sum, child) => sum + child.watched, 0);
    }
    visiting.delete(entry.node.id);
    seen.add(entry.node.id);
  }
  roots.sort((a, b) => a.node.order - b.node.order || a.node.sourceKey.localeCompare(b.node.sourceKey));
  roots.forEach(count);
  if (seen.size !== nodes.length) throw new Error('剧情树存在不可达节点或循环');
  return roots;
}

export function treeStats(tree: TreeNode[]) {
  return { watched: tree.reduce((sum, node) => sum + node.watched, 0), total: tree.reduce((sum, node) => sum + node.total, 0) };
}

function releaseDay(entry: TreeNode): string | null {
  return entry.node.releasedAt?.slice(0, 10) || null;
}

function firstReleaseDay(entry: TreeNode): string | null {
  return releaseDay(entry) ?? entry.children.map(firstReleaseDay).filter((day): day is string => day !== null).sort()[0] ?? null;
}

function compareDays(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function isCategory(entry: TreeNode): boolean {
  return !releaseDay(entry) && entry.children.length > 0 && entry.children.every(child => child.children.length > 0);
}

// Keep stage order within a chapter; sort chapter/category groups by their first release.
export function sortTreeByDate(tree: TreeNode[], projectLevel = true): TreeNode[] {
  const entries = tree.map(entry => ({ ...entry, children: sortTreeByDate(entry.children, false) }));
  if ((projectLevel || entries.some(entry => entry.children.length)) && !entries.every(isCategory)) {
    entries.sort((a, b) => compareDays(firstReleaseDay(a), firstReleaseDay(b)));
  }
  return entries;
}

export interface TimelineEntry {
  entry: TreeNode;
  category: string;
}

export function buildTimeline(lines: { title: string; tree: TreeNode[] }[]): TimelineEntry[] {
  const projects: TimelineEntry[] = [];
  function collect(entry: TreeNode, path: string[]) {
    // Undated containers are categories. A dated group or a group containing
    // playable stages remains one project, including projects with unknown dates.
    if (isCategory(entry)) {
      entry.children.forEach(child => collect(child, [...path, entry.node.title]));
    } else {
      projects.push({ entry, category: path.join(' / ') });
    }
  }
  lines.forEach(line => line.tree.forEach(entry => collect(entry, [line.title])));
  return projects.sort((a, b) => compareDays(firstReleaseDay(a.entry), firstReleaseDay(b.entry)));
}

export function searchTree(tree: TreeNode[], query: string, watchFilter: 'all' | 'watched' | 'unwatched' = 'all'): TreeNode[] {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return tree;
  function visit(entry: TreeNode, ancestorMatches: boolean): TreeNode | null {
    const matches = ancestorMatches || entry.node.title.toLocaleLowerCase().includes(text);
    if (!entry.children.length) {
      const watched = entry.node.watchedAt !== null;
      return matches && (watchFilter === 'all' || (watchFilter === 'watched' ? watched : !watched)) ? entry : null;
    }
    const children = entry.children.map(child => visit(child, matches)).filter((child): child is TreeNode => child !== null);
    return children.length ? { ...entry, children } : null;
  }
  return tree.map(entry => visit(entry, false)).filter((entry): entry is TreeNode => entry !== null);
}
