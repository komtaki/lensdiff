import type { DiffCommentThread } from '../types/diff.js';

import { mergeCommentThreads } from './commentImports.js';

export interface CommentThreadChanges {
  upserts: DiffCommentThread[];
  deletedIds: string[];
}

export function snapshotCommentThreads(threads: DiffCommentThread[]): Map<string, string> {
  return new Map(threads.map((thread) => [thread.id, JSON.stringify(thread)]));
}

export function diffCommentThreads(
  snapshot: Map<string, string>,
  threads: DiffCommentThread[],
): CommentThreadChanges {
  const currentIds = new Set(threads.map((thread) => thread.id));
  return {
    upserts: threads.filter((thread) => snapshot.get(thread.id) !== JSON.stringify(thread)),
    deletedIds: [...snapshot.keys()].filter((id) => !currentIds.has(id)),
  };
}

export function hasCommentThreadChanges(changes: CommentThreadChanges): boolean {
  return changes.upserts.length > 0 || changes.deletedIds.length > 0;
}

export function applyCommentThreadChanges(
  existing: DiffCommentThread[],
  changes: CommentThreadChanges,
  { mergeConcurrent }: { mergeConcurrent: boolean },
): DiffCommentThread[] {
  const deletedIds = new Set(changes.deletedIds);
  const remaining = existing.filter((thread) => !deletedIds.has(thread.id));
  if (mergeConcurrent) {
    return mergeCommentThreads(remaining, changes.upserts).threads;
  }

  const upsertsById = new Map(changes.upserts.map((thread) => [thread.id, thread]));
  const remainingIds = new Set(remaining.map((thread) => thread.id));
  return [
    ...remaining.map((thread) => upsertsById.get(thread.id) ?? thread),
    ...changes.upserts.filter((thread) => !remainingIds.has(thread.id)),
  ];
}
