export interface StoryCatalog {
  importerId?: string | null;
  game: { id: string; title: string };
  storyLines: { id: string; title: string; order: number }[];
  nodes: { sourceKey: string; storyLineId: string; parentKey: string | null; title: string; order: number; releasedAt?: string | null; sourceUrl?: string | null }[];
}

export interface StoryNode {
  id: string;
  gameId: string;
  storyLineId: string;
  parentId: string | null;
  sourceKey: string;
  title: string;
  order: number;
  active: boolean;
  watchedAt: string | null;
  releasedAt?: string | null;
  sourceUrl?: string | null;
}

export interface OrphanedProgress {
  stageId: string;
  gameId: string;
  title: string;
  watchedAt: string;
  reason: string;
}

export interface Snapshot {
  revision: number;
  games: { id: string; title: string; importerId?: string | null }[];
  storyLines: { id: string; gameId: string; title: string; order: number }[];
  nodes: StoryNode[];
  orphanedProgress: OrphanedProgress[];
}

export interface DiffPreview {
  revision: number;
  changes: { kind: 'add' | 'change' | 'archive' | 'restore'; entity: 'game' | 'storyLine' | 'node'; title: string; detail: string }[];
  orphanedProgress: OrphanedProgress[];
}

export interface ImportModule {
  apiVersion: number;
  id: string;
  name: string;
  gameId: string;
  runtime: string;
  entry: string;
  progressStoryLines?: string[];
}

export interface ImportRegistry { modules: ImportModule[]; errors: string[] }
export interface ImportResult { apiVersion: number; catalog: StoryCatalog; warnings: string[] }
