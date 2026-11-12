import { Circle, CircleDot } from 'lucide-react';

import { type CommitInfo } from '../../types/diff';

interface CommitScopeSelectorProps {
  commits: CommitInfo[];
  selectedHash: string | null;
  onSelect: (hash: string | null) => void;
}

interface CommitScopeOption {
  hash: string | null;
  label: string;
  title: string;
}

export function CommitScopeSelector({ commits, selectedHash, onSelect }: CommitScopeSelectorProps) {
  const scopeOptions: CommitScopeOption[] = [
    { hash: null, label: 'All changes', title: 'Review the whole diff' },
    ...commits.map((commit, index) => ({
      hash: commit.hash,
      label: `${index + 1}. ${commit.shortHash} ${commit.message}`,
      title: `${commit.shortHash} ${commit.message}`,
    })),
  ];

  return (
    <section className="shrink-0 border-b border-github-border bg-github-bg-tertiary px-4 py-3">
      <h3 className="m-0 mb-2 text-sm font-semibold text-github-text-primary">
        Commits ({commits.length})
      </h3>
      <div role="radiogroup" aria-label="Commits" className="max-h-[11rem] overflow-y-auto">
        {scopeOptions.map((option) => {
          const isSelected = option.hash === selectedHash;
          const Icon = isSelected ? CircleDot : Circle;
          return (
            <button
              key={option.hash ?? 'all'}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={option.title}
              onClick={() => onSelect(option.hash)}
              className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                isSelected
                  ? 'bg-diff-selected-bg font-semibold text-github-text-primary'
                  : 'text-github-text-secondary hover:bg-github-bg-primary hover:text-github-text-primary'
              }`}
            >
              <Icon size={12} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
