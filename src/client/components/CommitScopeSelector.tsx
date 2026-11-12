import { GitCommitHorizontal } from 'lucide-react';

import { type RangeCommit } from '../../types/diff';

const ALL_CHANGES_VALUE = '';

interface CommitScopeSelectorProps {
  commits: RangeCommit[];
  selectedHash: string | null;
  onSelect: (hash: string | null) => void;
}

export function CommitScopeSelector({ commits, selectedHash, onSelect }: CommitScopeSelectorProps) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-github-text-secondary">
      <GitCommitHorizontal size={14} aria-hidden="true" />
      <select
        aria-label="Commits"
        title="View one commit at a time (read-only)"
        value={selectedHash ?? ALL_CHANGES_VALUE}
        onChange={(event) => onSelect(event.target.value || null)}
        className="max-w-[260px] truncate bg-github-bg-tertiary border border-github-border rounded px-2 py-1 text-xs text-github-text-primary cursor-pointer"
      >
        <option value={ALL_CHANGES_VALUE}>All changes ({commits.length} commits)</option>
        {commits.map((commit, index) => (
          <option key={commit.hash} value={commit.hash}>
            {index + 1}. {commit.shortHash} {commit.subject}
          </option>
        ))}
      </select>
    </label>
  );
}
