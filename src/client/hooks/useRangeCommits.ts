import { useEffect, useState } from 'react';

import type { CommitInfo } from '../../types/diff';
import { fetchJson, isRecord } from '../utils/fetchJson';

const isCommitInfo = (value: unknown): value is CommitInfo =>
  isRecord(value) &&
  typeof value.hash === 'string' &&
  typeof value.shortHash === 'string' &&
  typeof value.message === 'string';

async function fetchRangeCommits(): Promise<CommitInfo[]> {
  const payload = await fetchJson('/api/commits');
  if (!isRecord(payload) || !Array.isArray(payload.commits)) return [];
  return payload.commits.filter(isCommitInfo);
}

export function useRangeCommits(rangeKey: string | null): CommitInfo[] {
  const [commits, setCommits] = useState<CommitInfo[]>([]);

  useEffect(() => {
    if (!rangeKey) return undefined;

    let cancelled = false;
    void fetchRangeCommits().then((nextCommits) => {
      if (!cancelled) setCommits(nextCommits);
    });
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  return commits;
}
