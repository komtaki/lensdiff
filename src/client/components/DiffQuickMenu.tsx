import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useHover,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  safePolygon,
} from '@floating-ui/react';
import { ChevronDown, GitBranch, Search } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { type CommitInfo, type DiffSelection, type RevisionsResponse } from '../../types/diff';
import {
  createDiffSelection,
  diffSelectionsEqual,
  normalizeBaseMode,
} from '../../utils/diffSelection';

interface DiffQuickMenuProps {
  options: RevisionsResponse;
  selection: DiffSelection;
  resolvedBaseRevision?: string;
  resolvedTargetRevision?: string;
  onSelectDiff: (selection: DiffSelection) => void;
  onOpenAdvanced: () => void;
  compact?: boolean;
}

const SPECIAL_LABEL_OVERRIDES: Record<string, string> = {
  '.': 'Uncommitted Changes',
  staged: 'Staging Area',
  working: 'Working Directory',
};

const isPreviousPair = (selection: DiffSelection) => {
  if (normalizeBaseMode(selection.baseMode) === 'merge-base') {
    return false;
  }

  return (
    Boolean(selection.targetCommitish) &&
    selection.baseCommitish === `${selection.targetCommitish}^`
  );
};

const matchesCommitish = (value: string | undefined, commit: CommitInfo) => {
  if (!value) return false;
  return value === commit.shortHash || value === commit.hash;
};

const getCommitLabel = (commit: CommitInfo, withCaret: boolean) => {
  return withCaret ? `${commit.shortHash}^` : commit.shortHash;
};

const resolveDisplayLabel = (
  options: RevisionsResponse,
  value: string,
  resolvedValue?: string,
): string => {
  if (!value) return 'Select...';

  const caret = value.endsWith('^');
  const baseValue = caret ? value.slice(0, -1) : value;

  if (baseValue.startsWith('HEAD')) {
    return value;
  }

  const override = SPECIAL_LABEL_OVERRIDES[value];
  if (override) return override;

  const special = options.specialOptions.find((opt) => opt.value === value);
  if (special) return special.label;

  const branch = options.branches.find((b) => b.name === baseValue);
  if (branch) return caret ? `${branch.name}^` : branch.name;

  const commit = options.commits.find((c) => c.shortHash === baseValue || c.hash === baseValue);
  if (commit) return getCommitLabel(commit, caret);

  if (resolvedValue) {
    const resolvedCommit = options.commits.find(
      (c) => c.shortHash === resolvedValue || c.hash === resolvedValue,
    );
    if (resolvedCommit) return getCommitLabel(resolvedCommit, false);
  }

  return value;
};

export function DiffQuickMenu({
  options,
  selection,
  resolvedBaseRevision,
  resolvedTargetRevision,
  onSelectDiff,
  onOpenAdvanced,
  compact = false,
}: DiffQuickMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isCompact = compact;

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      setIsOpen(open);
      if (!open) setQuery('');
    },
    placement: 'bottom-end',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    handleClose: safePolygon(),
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role]);

  const currentLabel = useMemo(() => {
    const currentSelectionIsPreviousPair = isPreviousPair(selection);
    const commitMatch = options.commits.find((commit) => {
      if (!currentSelectionIsPreviousPair) return false;
      return (
        matchesCommitish(selection.targetCommitish, commit) ||
        matchesCommitish(resolvedTargetRevision, commit)
      );
    });

    if (commitMatch) {
      return `${commitMatch.shortHash} ${commitMatch.message}`;
    }

    const baseLabel = resolveDisplayLabel(options, selection.baseCommitish, resolvedBaseRevision);
    const targetLabel = resolveDisplayLabel(
      options,
      selection.targetCommitish,
      resolvedTargetRevision,
    );
    const mergeBaseSuffix =
      normalizeBaseMode(selection.baseMode) === 'merge-base' ? ' (merge-base)' : '';
    return `${baseLabel}...${targetLabel}${mergeBaseSuffix}`;
  }, [options, selection, resolvedBaseRevision, resolvedTargetRevision]);

  const mainBranch = useMemo(
    () =>
      options.branches.find((branch) => branch.name === 'main') ||
      options.branches.find((branch) => branch.name === 'master'),
    [options.branches],
  );

  const originDefaultBranch = options.originDefaultBranch;
  const headPreset = useMemo(() => createDiffSelection('HEAD^', 'HEAD'), []);
  const headUncommittedPreset = useMemo(() => createDiffSelection('HEAD', '.', 'merge-base'), []);
  const mainUncommittedPreset = useMemo(
    () => (mainBranch ? createDiffSelection(mainBranch.name, '.', 'merge-base') : null),
    [mainBranch],
  );
  const originUncommittedPreset = useMemo(
    () =>
      originDefaultBranch ? createDiffSelection(originDefaultBranch, '.', 'merge-base') : null,
    [originDefaultBranch],
  );
  const handleSelect = (nextSelection: DiffSelection) => {
    onSelectDiff(nextSelection);
    setIsOpen(false);
    setQuery('');
  };

  const handleOpenAdvanced = () => {
    setIsOpen(false);
    setQuery('');
    onOpenAdvanced();
  };

  const presetItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      selection: DiffSelection;
    }> = [
      { key: 'head', label: 'HEAD (last commit)', selection: headPreset },
      {
        key: 'head-uncommitted',
        label: 'HEAD...Uncommitted (merge-base)',
        selection: headUncommittedPreset,
      },
    ];
    if (mainBranch && mainUncommittedPreset) {
      items.push({
        key: 'main-uncommitted',
        label: `${mainBranch.name}...Uncommitted (merge-base)`,
        selection: mainUncommittedPreset,
      });
    }
    if (originDefaultBranch && originUncommittedPreset) {
      items.push({
        key: 'origin-uncommitted',
        label: `${originDefaultBranch}...Uncommitted (merge-base)`,
        selection: originUncommittedPreset,
      });
    }
    return items;
  }, [
    headPreset,
    headUncommittedPreset,
    mainBranch,
    mainUncommittedPreset,
    originDefaultBranch,
    originUncommittedPreset,
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;
  const matchesQuery = (...texts: string[]) =>
    texts.some((text) => text.toLowerCase().includes(normalizedQuery));

  const filteredPresets = isFiltering
    ? presetItems.filter((item) => matchesQuery(item.label))
    : presetItems;
  const filteredBranches = isFiltering
    ? options.branches.filter((branch) => matchesQuery(branch.name))
    : [];

  const hasNoMatches = isFiltering && filteredPresets.length === 0 && filteredBranches.length === 0;

  const branchSelection = (branchName: string) =>
    createDiffSelection(branchName, '.', 'merge-base');

  // Select the first match when pressing Enter in the search box
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !isFiltering) return;
    event.preventDefault();

    const firstMatch =
      filteredPresets[0]?.selection ??
      (filteredBranches[0] ? branchSelection(filteredBranches[0].name) : undefined);
    if (firstMatch) {
      handleSelect(firstMatch);
    }
  };

  const getItemClasses = (highlighted: boolean, disabled: boolean) => {
    const highlightClasses = highlighted
      ? 'bg-diff-selected-bg border-l-4 border-l-diff-selected-border font-semibold pl-2'
      : '';
    const hoverClasses = highlighted
      ? 'hover:bg-diff-selected-bg focus:bg-diff-selected-bg'
      : 'hover:bg-github-bg-tertiary focus:bg-github-bg-tertiary';
    const cursorClasses = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

    return [
      'w-full text-left px-3 py-2 text-xs focus:outline-none transition-colors',
      hoverClasses,
      highlightClasses,
      cursorClasses,
    ].join(' ');
  };

  const isPresetActive = (preset: DiffSelection) => {
    return diffSelectionsEqual(selection, preset);
  };

  return (
    <div className="relative">
      <button
        ref={refs.setReference}
        type="button"
        className="flex min-w-0 shrink-0 items-center gap-1.5 cursor-pointer group"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Revision menu: ${currentLabel}`}
        title={currentLabel}
        {...getReferenceProps()}
      >
        {isCompact ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-github-bg-tertiary border border-github-border rounded hover:border-github-text-secondary transition-colors">
            <GitBranch size={14} className="text-github-text-secondary" />
            <ChevronDown
              size={12}
              className="text-github-text-secondary group-hover:text-github-text-primary transition-colors"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-1 bg-github-bg-tertiary border border-github-border rounded hover:border-github-text-secondary transition-colors">
            <code className="max-w-[min(40vw,36rem)] truncate whitespace-nowrap text-xs text-github-text-primary">
              {currentLabel}
            </code>
            <ChevronDown
              size={12}
              className="text-github-text-secondary group-hover:text-github-text-primary transition-colors"
            />
          </div>
        )}
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="bg-github-bg-secondary border border-github-border rounded shadow-lg z-50 w-[320px] max-h-[400px] overflow-y-auto"
            {...getFloatingProps()}
          >
            {/* Search box */}
            <div className="sticky top-0 z-10 border-b border-github-border bg-github-bg-secondary p-2">
              <div className="flex items-center gap-2 rounded border border-github-border bg-github-bg-primary px-2 py-1.5 focus-within:border-blue-600">
                <Search size={12} className="shrink-0 text-github-text-secondary" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Filter ranges and branches..."
                  aria-label="Filter ranges and branches"
                  className="w-full bg-transparent text-xs text-github-text-primary placeholder:text-github-text-muted focus:outline-none"
                />
              </div>
            </div>

            {isFiltering ? (
              <>
                {filteredPresets.length > 0 && (
                  <div className="border-b border-github-border">
                    <div className="px-3 py-2 text-xs font-semibold text-github-text-secondary bg-github-bg-tertiary">
                      Review range
                    </div>
                    {filteredPresets.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => handleSelect(item.selection)}
                        className={getItemClasses(isPresetActive(item.selection), false)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}

                {filteredBranches.length > 0 && (
                  <div className="border-b border-github-border">
                    <div className="px-3 py-2 text-xs font-semibold text-github-text-secondary bg-github-bg-tertiary">
                      Branches
                    </div>
                    {filteredBranches.map((branch) => (
                      <button
                        key={branch.name}
                        onClick={() => handleSelect(branchSelection(branch.name))}
                        className={getItemClasses(
                          isPresetActive(branchSelection(branch.name)),
                          false,
                        )}
                        type="button"
                        title={`${branch.name}...Uncommitted (merge-base)`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-github-text-primary">{branch.name}</span>
                          {branch.current && (
                            <span className="text-xs text-github-text-muted">(current)</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {hasNoMatches && (
                  <div className="px-3 py-4 text-center text-xs text-github-text-muted">
                    No matching ranges or branches
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="border-b border-github-border">
                  <div className="px-3 py-2 text-xs font-semibold text-github-text-secondary bg-github-bg-tertiary">
                    Review range
                  </div>
                  {presetItems.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleSelect(item.selection)}
                      className={getItemClasses(isPresetActive(item.selection), false)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div>
                  <button
                    onClick={handleOpenAdvanced}
                    className={getItemClasses(false, false)}
                    type="button"
                  >
                    Custom range (Base / Target)...
                  </button>
                </div>
              </>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
