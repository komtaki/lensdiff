import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DiffQuickMenu } from './DiffQuickMenu';

const options = {
  specialOptions: [
    { value: '.', label: 'All Uncommitted Changes' },
    { value: 'staged', label: 'Staging Area' },
    { value: 'working', label: 'Working Directory' },
  ],
  branches: [{ name: 'main', current: true }],
  commits: [
    {
      hash: '1f23cd1aaaaabbbbbcccccdddddeeeeefffff000',
      shortHash: '1f23cd1',
      message: 'chore: release v3.1.5',
    },
  ],
  originDefaultBranch: 'origin/main',
};

describe('DiffQuickMenu', () => {
  it('shows commit label when previous-pair target resolves to a listed commit', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD^^', targetCommitish: 'HEAD^' },
        resolvedBaseRevision: '88aabb0',
        resolvedTargetRevision: '1f23cd1',
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    expect(screen.getByText('1f23cd1 chore: release v3.1.5')).toBeInTheDocument();
  });

  it('shows only requested quick diff presets', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));

    expect(
      screen.getByRole('button', { name: 'HEAD...Uncommitted (merge-base)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'main...Uncommitted (merge-base)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'origin/main...Uncommitted (merge-base)',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HEAD (last commit)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'HEAD...Staging' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Staging...Working' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'main...HEAD' })).not.toBeInTheDocument();
  });

  it('places HEAD at the top of quick diffs', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));

    const quickDiffSection = screen.getByText('Review range').parentElement;
    expect(quickDiffSection).not.toBeNull();

    const quickDiffButtons = within(quickDiffSection!).getAllByRole('button');
    expect(quickDiffButtons[0]).toHaveTextContent('HEAD (last commit)');
  });

  it('selects HEAD commit when HEAD quick preset is clicked', () => {
    const onSelectDiff = vi.fn();
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff,
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'HEAD (last commit)' }));

    expect(onSelectDiff).toHaveBeenCalledWith({
      baseCommitish: 'HEAD^',
      targetCommitish: 'HEAD',
    });
  });

  it('selects origin/main merge-base quick preset when available', () => {
    const onSelectDiff = vi.fn();
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff,
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'origin/main...Uncommitted (merge-base)',
      }),
    );

    expect(onSelectDiff).toHaveBeenCalledWith({
      baseCommitish: 'origin/main',
      targetCommitish: '.',
      baseMode: 'merge-base',
    });
  });

  it('selects branch...Uncommitted (merge-base) when a filtered branch is clicked', () => {
    const onSelectDiff = vi.fn();
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff,
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.change(screen.getByPlaceholderText('Filter ranges and branches...'), {
      target: { value: 'main' },
    });

    const branchesSection = screen.getByText('Branches').parentElement;
    expect(branchesSection).not.toBeNull();
    fireEvent.click(
      within(branchesSection!).getByRole('button', {
        name: /main \(current\)/,
      }),
    );

    expect(onSelectDiff).toHaveBeenCalledWith({
      baseCommitish: 'main',
      targetCommitish: '.',
      baseMode: 'merge-base',
    });
  });

  it('selects the first match when pressing Enter in the search box', () => {
    const onSelectDiff = vi.fn();
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff,
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    const searchInput = screen.getByPlaceholderText('Filter ranges and branches...');
    fireEvent.change(searchInput, { target: { value: 'origin' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    expect(onSelectDiff).toHaveBeenCalledWith({
      baseCommitish: 'origin/main',
      targetCommitish: '.',
      baseMode: 'merge-base',
    });
  });

  it('shows an empty state when nothing matches the search query', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    fireEvent.change(screen.getByPlaceholderText('Filter ranges and branches...'), {
      target: { value: 'does-not-exist' },
    });

    expect(screen.getByText('No matching ranges or branches')).toBeInTheDocument();
  });

  it('offers review ranges only, without per-commit switching', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Revision menu:/ }));
    expect(screen.queryByRole('button', { name: 'Previous commit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pick Commit/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Custom range (Base / Target)...' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter ranges and branches...'), {
      target: { value: 'release' },
    });
    expect(screen.queryByRole('button', { name: /1f23cd1/ })).not.toBeInTheDocument();
    expect(screen.getByText('No matching ranges or branches')).toBeInTheDocument();
  });

  it('shows merge-base in the current label', () => {
    render(
      createElement(DiffQuickMenu, {
        options,
        selection: {
          baseCommitish: 'origin/main',
          targetCommitish: '.',
          baseMode: 'merge-base',
        },
        onSelectDiff: vi.fn(),
        onOpenAdvanced: vi.fn(),
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Revision menu: origin/main...Uncommitted Changes (merge-base)',
      }),
    ).toBeInTheDocument();
  });
});
