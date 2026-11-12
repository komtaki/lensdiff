import { describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../types/diff';

import {
  applyCommentThreadChanges,
  diffCommentThreads,
  hasCommentThreadChanges,
  snapshotCommentThreads,
} from './commentThreadChanges';

const timestamp = '2024-01-01T00:00:00.000Z';

function createThread(id: string, body: string, line = 10): DiffCommentThread {
  return {
    id,
    filePath: 'src/example.ts',
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line },
    messages: [{ id: `${id}-root`, body, createdAt: timestamp, updatedAt: timestamp }],
  };
}

function withReply(thread: DiffCommentThread, replyId: string, body: string): DiffCommentThread {
  return {
    ...thread,
    messages: [
      ...thread.messages,
      { id: replyId, body, createdAt: '2024-01-02T00:00:00.000Z', updatedAt: timestamp },
    ],
  };
}

describe('diffCommentThreads', () => {
  it('returns no changes when the threads match the snapshot', () => {
    const threads = [createThread('t1', 'first'), createThread('t2', 'second')];

    const changes = diffCommentThreads(snapshotCommentThreads(threads), threads);

    expect(changes).toEqual({ upserts: [], deletedIds: [] });
    expect(hasCommentThreadChanges(changes)).toBe(false);
  });

  it('upserts added and edited threads in thread order', () => {
    const snapshot = snapshotCommentThreads([createThread('t1', 'first'), createThread('t2', 'b')]);
    const edited = createThread('t1', 'edited');
    const added = createThread('t3', 'third');

    const changes = diffCommentThreads(snapshot, [edited, createThread('t2', 'b'), added]);

    expect(changes).toEqual({ upserts: [edited, added], deletedIds: [] });
    expect(hasCommentThreadChanges(changes)).toBe(true);
  });

  it('reports threads missing from the current list as deleted', () => {
    const snapshot = snapshotCommentThreads([createThread('t1', 'first'), createThread('t2', 'b')]);

    const changes = diffCommentThreads(snapshot, [createThread('t2', 'b')]);

    expect(changes).toEqual({ upserts: [], deletedIds: ['t1'] });
    expect(hasCommentThreadChanges(changes)).toBe(true);
  });
});

describe('applyCommentThreadChanges', () => {
  it('replaces in place, appends new threads, removes deleted ones and keeps untouched ones', () => {
    const existing = [
      createThread('t1', 'first'),
      createThread('t2', 'second'),
      createThread('t3', 'third'),
    ];
    const edited = createThread('t2', 'edited');
    const added = createThread('t4', 'fourth');

    const result = applyCommentThreadChanges(
      existing,
      { upserts: [added, edited], deletedIds: ['t1'] },
      { mergeConcurrent: false },
    );

    expect(result).toEqual([edited, createThread('t3', 'third'), added]);
    expect(existing.map((thread) => thread.id)).toEqual(['t1', 't2', 't3']);
    expect(existing[1]?.messages[0]?.body).toBe('second');
  });

  it('merges messages of concurrently changed threads when mergeConcurrent is set', () => {
    const base = createThread('t1', 'first');
    const existing = [withReply(base, 'agent-reply', 'agent reply')];

    const result = applyCommentThreadChanges(
      existing,
      { upserts: [withReply(base, 'human-reply', 'human reply')], deletedIds: [] },
      { mergeConcurrent: true },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.messages.map((message) => message.id)).toEqual([
      't1-root',
      'agent-reply',
      'human-reply',
    ]);
    expect(existing[0]?.messages).toHaveLength(2);
  });

  it('honors explicit deletions even when mergeConcurrent is set', () => {
    const existing = [createThread('t1', 'first'), createThread('agent-1', 'agent finding', 20)];

    const result = applyCommentThreadChanges(
      existing,
      { upserts: [], deletedIds: ['t1'] },
      { mergeConcurrent: true },
    );

    expect(result.map((thread) => thread.id)).toEqual(['agent-1']);
  });
});
