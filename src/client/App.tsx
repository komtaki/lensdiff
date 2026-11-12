import {
  Columns,
  AlignLeft,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Keyboard,
  Check,
  Lock,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import {
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type DiffViewMode,
  type DiffSide,
  type LineNumber,
  type CommentThread,
  type RevisionsResponse,
} from '../types/diff';
import { DEFAULT_DIFF_VIEW_MODE, normalizeDiffViewMode } from '../utils/diffMode';
import { getThreadKind, mergeCommentThreads } from '../utils/commentImports';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
  normalizeBaseMode,
} from '../utils/diffSelection';
import { selectThreadsForOutput } from '../utils/reviewOutput';

import { Checkbox } from './components/Checkbox';
import { CommentsDropdown } from './components/CommentsDropdown';
import { CommentsListModal } from './components/CommentsListModal';
import { CommitScopeSelector } from './components/CommitScopeSelector';
import { DiffQuickMenu } from './components/DiffQuickMenu';
import { DiffMinimap } from './components/DiffMinimap';
import { DiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { FindingsPanel } from './components/FindingsPanel';
import { GitHubIcon } from './components/GitHubIcon';
import { HelpModal } from './components/HelpModal';
import { Logo } from './components/Logo';
import { OverviewPanel } from './components/OverviewPanel';
import { ReloadButton } from './components/ReloadButton';
import { RevisionDetailModal } from './components/RevisionDetailModal';
import { ReviewTabs, type ReviewTab } from './components/ReviewTabs';
import { SettingsModal } from './components/SettingsModal';
import { SparkleAnimation } from './components/SparkleAnimation';
import { SymbolPanel } from './components/SymbolPanel';
import { ReviewThreadProvider } from './contexts/ReviewThreadContext';
import { WordHighlightProvider } from './contexts/WordHighlightContext';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';
import { useDiffComments } from './hooks/useDiffComments';
import { useExpandedLines, type MergedChunk } from './hooks/useExpandedLines';
import { useFileWatch } from './hooks/useFileWatch';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useLazyDiffRendering } from './hooks/useLazyDiffRendering';
import { useRangeCommits } from './hooks/useRangeCommits';
import { useReviewContext } from './hooks/useReviewContext';
import { useSymbolNavigation } from './hooks/useSymbolNavigation';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';
import { fetchClientSettings, saveClientSettings } from './services/userSettings';
import { hasMultipleCommentAuthors } from './utils/commentAuthors';
import { copyTextToClipboard } from './utils/clipboard';
import { getFileElementId } from './utils/domUtils';
import { estimateFileHeight } from './utils/fileHeightEstimate';
import { getElementId } from './utils/navigation/domHelpers';
import {
  findCommentPosition,
  findFirstChangePosition,
  findLinePosition,
} from './utils/navigation/positionHelpers';
import { resolveEventSourceUrl } from './utils/eventSourceUrl';
import {
  EMPTY_MERGED_CHUNKS_STATE,
  buildMergedChunksState,
  getMergedChunksForVersion,
} from './utils/mergedChunks';
import { buildFileLineIndex, isThreadOutdated } from './utils/outdatedComments';
import {
  countFindingsByReviewer,
  countOpenFindingsByFile,
  isFindingThread,
  isHiddenInDiff,
  preserveServerFindingHistory,
} from './utils/reviewThreads';
import { findSymbolTarget } from './utils/symbolTarget';
import { getViewerForFile } from './viewers/registry';

const EMPTY_COMMENT_THREADS: CommentThread[] = [];
const EMPTY_DIFF_COMMENT_THREADS: DiffCommentThread[] = [];
const EMPTY_MERGED_CHUNKS: MergedChunk[] = [];
const DIFF_VIEW_MODE_STORAGE_KEY = 'difit.diffViewMode';
const SIDEBAR_WIDTH_STORAGE_KEY = 'difit.sidebarWidth';
const SIDEBAR_OPEN_STORAGE_KEY = 'difit.sidebarOpen';
const SHOW_FULL_FILE_STORAGE_KEY = 'difit.showFullFile';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SYMBOL_PANEL_MIN_WIDTH = 320;
const SYMBOL_PANEL_MAX_WIDTH = 1200;
const SYMBOL_PANEL_DEFAULT_WIDTH = 560;

const parseDiffViewMode = (value: unknown): DiffViewMode | null => {
  switch (value) {
    case 'split':
    case 'side-by-side':
    case 'unified':
    case 'inline':
      return normalizeDiffViewMode(value);
    default:
      return null;
  }
};

const getStoredDiffViewMode = (): DiffViewMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseDiffViewMode(window.localStorage.getItem(DIFF_VIEW_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const getInitialDiffViewMode = () => getStoredDiffViewMode() ?? DEFAULT_DIFF_VIEW_MODE;

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

const clampSymbolPanelWidth = (width: number) =>
  Math.min(SYMBOL_PANEL_MAX_WIDTH, Math.max(SYMBOL_PANEL_MIN_WIDTH, width));

const getStoredSidebarWidth = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clampSidebarWidth(parsed);
};

const getInitialSidebarWidth = () => getStoredSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH;

const getStoredBoolean = (key: string): boolean | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(key);
    if (stored === 'true') {
      return true;
    }
    if (stored === 'false') {
      return false;
    }
  } catch {
    // Ignore localStorage errors (e.g. disabled storage).
  }
  return null;
};

const getInitialFileTreeOpen = () => getStoredBoolean(SIDEBAR_OPEN_STORAGE_KEY) ?? true;

const getInitialShowFullFile = () => getStoredBoolean(SHOW_FULL_FILE_STORAGE_KEY) ?? true;

const isAbortError = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';

function App() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [commitDiffData, setCommitDiffData] = useState<DiffResponse | null>(null);
  const isCommitView = commitDiffData !== null;
  const displayedDiffData = commitDiffData ?? diffData;
  const selectedCommitHash = commitDiffData?.commitScope ?? null;
  const selectedCommitHashRef = useRef(selectedCommitHash);
  selectedCommitHashRef.current = selectedCommitHash;
  const [diffDataVersion, setDiffDataVersion] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(getInitialDiffViewMode);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [showFullFile, setShowFullFile] = useState(getInitialShowFullFile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [symbolPanelWidth, setSymbolPanelWidth] = useState(SYMBOL_PANEL_DEFAULT_WIDTH);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(getInitialFileTreeOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [hasTriggeredSparkles, setHasTriggeredSparkles] = useState(false);
  const [isCommentsListOpen, setIsCommentsListOpen] = useState(false);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [approveStatus, setApproveStatus] = useState<'idle' | 'pending' | 'approved' | 'failed'>(
    'idle',
  );
  const isApproved = approveStatus === 'approved';
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const collapsedInitializedRef = useRef(false);
  const diffScrollContainerRef = useRef<HTMLElement | null>(null);

  // Revision selector state
  const [revisionOptions, setRevisionOptions] = useState<RevisionsResponse | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<DiffSelection>(
    createDiffSelection('', ''),
  );
  const [resolvedBaseRevision, setResolvedBaseRevision] = useState<string>('');
  const [resolvedTargetRevision, setResolvedTargetRevision] = useState<string>('');
  const hasUserSelectedRevisionRef = useRef(false);
  const currentRequestedBaseModeRef = useRef(selectedRevision.baseMode);
  currentRequestedBaseModeRef.current = diffData?.requestedBaseMode ?? selectedRevision.baseMode;
  const selectedRevisionRef = useRef(selectedRevision);
  selectedRevisionRef.current = selectedRevision;
  const diffRequestIdRef = useRef(0);
  const activeDiffAbortControllerRef = useRef<AbortController | null>(null);
  const commitDiffRequestIdRef = useRef(0);
  const activeCommitDiffAbortControllerRef = useRef<AbortController | null>(null);
  const resolvedSelection = useMemo<DiffSelection | null>(() => {
    if (!diffData?.baseCommitish || !diffData?.targetCommitish) {
      return null;
    }

    return createDiffSelection(
      diffData.baseCommitish,
      diffData.targetCommitish,
      diffData.requestedBaseMode,
    );
  }, [diffData]);
  const resolvedSelectionKey = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    return getDiffSelectionKey(resolvedSelection);
  }, [resolvedSelection]);

  const { settings, updateSettings } = useAppearanceSettings();
  const { isMobile, isDesktop } = useViewport();

  // New diff-aware comment system
  const {
    hasLoadedComments,
    threads,
    replaceThreads,
    addThread,
    replyToThread,
    removeThread,
    removeMessage,
    updateMessage,
    setFindingDecision,
    clearAllComments,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  } = useDiffComments(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit, // Using commit as currentCommitHash
    undefined, // branchToHash map - could be populated from server data
    diffData?.repositoryId, // Repository identifier for storage isolation
    resolvedSelection?.baseMode,
  );

  // The whole-diff threads keep syncing and feed the exit output; a single commit only hides them.
  const reviewThreads = isCommitView ? EMPTY_DIFF_COMMENT_THREADS : threads;
  const showMobileCommentsBar = isMobile && reviewThreads.length > 0;
  const commentsContextKey = useMemo(() => {
    if (!resolvedSelectionKey) {
      return null;
    }

    return `${diffData?.repositoryId ?? 'default'}:${resolvedSelectionKey}`;
  }, [diffData?.repositoryId, resolvedSelectionKey]);
  const commentSessionQueryString = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    const params = new URLSearchParams({
      base: resolvedSelection.baseCommitish,
      target: resolvedSelection.targetCommitish,
    });
    if (resolvedSelection.baseMode === 'merge-base') {
      params.set('baseMode', resolvedSelection.baseMode);
    }

    return params.toString();
  }, [resolvedSelection]);
  const getCommentApiUrl = useCallback(
    (path: string) => {
      if (!commentSessionQueryString) {
        return path;
      }
      return `${path}?${commentSessionQueryString}`;
    },
    [commentSessionQueryString],
  );
  const [bootstrappedCommentsKey, setBootstrappedCommentsKey] = useState<string | null>(null);
  const hasBootstrappedComments =
    commentsContextKey !== null && commentsContextKey === bootstrappedCommentsKey;
  const bootstrappingCommentsKeyRef = useRef<string | null>(null);
  const skipNextCommentSyncRef = useRef(false);
  // Last server comment version seen; echoed back as baseVersion so the server can detect concurrent writes.
  const serverCommentVersionRef = useRef<number | null>(null);
  const pendingBootstrapAfterLocalResetRef = useRef(false);

  useEffect(() => {
    if (commentsContextKey !== bootstrappedCommentsKey) {
      skipNextCommentSyncRef.current = false;
    }
  }, [bootstrappedCommentsKey, commentsContextKey]);

  const fetchServerThreads = useCallback(async (): Promise<DiffCommentThread[]> => {
    const response = await fetch(getCommentApiUrl('/api/comments-json'));
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      version?: number;
      threads?: DiffCommentThread[];
    };
    if (typeof payload.version === 'number') {
      serverCommentVersionRef.current = payload.version;
    }
    return Array.isArray(payload.threads) ? payload.threads : [];
  }, [getCommentApiUrl]);

  const serializeCommentsPayload = useCallback(
    (nextThreads: DiffCommentThread[]) =>
      JSON.stringify({
        threads: nextThreads,
        baseVersion: serverCommentVersionRef.current ?? undefined,
      }),
    [],
  );

  const syncThreadsToServer = useCallback(
    async (nextThreads: DiffCommentThread[]) => {
      const response = await fetch(getCommentApiUrl('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeCommentsPayload(nextThreads),
      });
      if (!response.ok) {
        return;
      }

      const result = (await response.json()) as {
        version?: number;
        merged?: boolean;
        threads?: DiffCommentThread[];
      };
      if (typeof result.version === 'number') {
        serverCommentVersionRef.current = result.version;
      }
      // Server merged in a concurrent change; adopt it so we don't push a stale set back.
      if (result.merged && Array.isArray(result.threads)) {
        skipNextCommentSyncRef.current = true;
        replaceThreads(result.threads);
      }
    },
    [getCommentApiUrl, replaceThreads, serializeCommentsPayload],
  );

  // Viewed files management
  const {
    viewedFiles,
    changedSinceViewedFiles,
    hasLoadedInitialViewedFiles,
    toggleFileViewed,
    setFilesViewed,
    clearViewedFiles,
  } = useViewedFiles(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit,
    undefined,
    diffData?.files,
    diffData?.repositoryId, // Repository identifier for storage isolation
    settings.autoViewedPatterns,
    resolvedSelection?.baseMode,
  );

  // Reset initialization flag when diff context changes
  useEffect(() => {
    collapsedInitializedRef.current = false;
  }, [diffData?.repositoryId, resolvedSelectionKey, diffData?.commit]);

  // Initialize collapsed files from viewed files (only once per diff)
  useEffect(() => {
    if (!collapsedInitializedRef.current && hasLoadedInitialViewedFiles) {
      setCollapsedFiles(new Set(viewedFiles));
      collapsedInitializedRef.current = true;
    }
  }, [viewedFiles, hasLoadedInitialViewedFiles]);
  const {
    renderedFilePaths,
    ensureFileRendered,
    ensureFilesRenderedUpTo,
    registerLazyFileContainer,
    scrollFileIntoDiffContainer,
    isFileScrolledPastContainerTop,
  } = useLazyDiffRendering({
    diffData: displayedDiffData,
    diffScrollContainerRef,
    setDiffData: isCommitView ? setCommitDiffData : setDiffData,
  });

  const toggleFileReviewed = useCallback(
    async (filePath: string) => {
      if (!diffData || isCommitView) return;

      const file = diffData.files.find((f) => f.path === filePath);
      if (!file) return;

      const wasViewed = viewedFiles.has(filePath);
      // Measure before the collapse re-renders: only re-anchor the header when
      // the user is scrolled past it (deep inside a long file), so the viewport
      // doesn't land in unrelated content after collapsing (#164). If the header
      // is already visible, stay stationary and let files below fill up (#402).
      const shouldScrollToHeader = !wasViewed && isFileScrolledPastContainerTop(filePath);
      await toggleFileViewed(filePath, file);

      // Update collapsed state based on viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        if (!wasViewed) {
          // Marking as viewed -> collapse the file
          newSet.add(filePath);
        } else {
          // Marking as not viewed -> expand the file
          newSet.delete(filePath);
        }
        return newSet;
      });

      if (shouldScrollToHeader) {
        setTimeout(() => {
          scrollFileIntoDiffContainer(filePath);
        }, 100);
      }
    },
    [
      diffData,
      isCommitView,
      isFileScrolledPastContainerTop,
      scrollFileIntoDiffContainer,
      toggleFileViewed,
      viewedFiles,
    ],
  );

  const toggleFolderReviewed = useCallback(
    async (folderPath: string, reviewed: boolean) => {
      if (!diffData || isCommitView) return;

      const folderFiles = diffData.files.filter((file) => file.path.startsWith(`${folderPath}/`));
      if (folderFiles.length === 0) return;

      await setFilesViewed(folderFiles, reviewed);

      // Keep the collapse state of every file in the folder in sync with its viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        folderFiles.forEach((file) => {
          if (reviewed) {
            newSet.add(file.path);
          } else {
            newSet.delete(file.path);
          }
        });
        return newSet;
      });
    },
    [diffData, isCommitView, setFilesViewed],
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const toggleAllFilesCollapsed = useCallback(
    (shouldCollapse: boolean) => {
      if (!displayedDiffData) return;

      if (shouldCollapse) {
        // Collapse all files
        setCollapsedFiles(new Set(displayedDiffData.files.map((f) => f.path)));
      } else {
        // Expand all files
        setCollapsedFiles(new Set());
      }
    },
    [displayedDiffData],
  );

  const handleMobileFileSelected = useCallback(() => {
    setIsFileTreeOpen(false);
  }, []);

  const handleDiffModeChange = useCallback((mode: DiffViewMode) => {
    setDiffMode(mode);
    try {
      window.localStorage.setItem(DIFF_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    saveClientSettings({ diffViewMode: mode });
  }, []);

  const handleShowFullFileChange = useCallback((nextShowFullFile: boolean) => {
    setShowFullFile(nextShowFullFile);
    try {
      window.localStorage.setItem(SHOW_FULL_FILE_STORAGE_KEY, String(nextShowFullFile));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    saveClientSettings({ showFullFile: nextShowFullFile });
  }, []);

  // Lift expand state to App level so navigation and rendering share the same merged chunks
  const {
    isLoading: isExpandLoading,
    expandLines,
    expandAllBetweenChunks,
    prefetchFileContent,
    getMergedChunks,
    lastUpdatedAt,
  } = useExpandedLines({
    baseCommitish: displayedDiffData?.baseCommitish,
    targetCommitish: displayedDiffData?.targetCommitish,
    diffIdentity: diffDataVersion,
  });

  const getMergedChunksRef = useRef(getMergedChunks);
  useEffect(() => {
    getMergedChunksRef.current = getMergedChunks;
  }, [getMergedChunks]);

  const [mergedChunksState, setMergedChunksState] = useState(EMPTY_MERGED_CHUNKS_STATE);
  const filesByPath = useMemo(() => {
    const map = new Map<string, DiffResponse['files'][number]>();
    displayedDiffData?.files.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [displayedDiffData]);

  // Recompute merged chunks for the current fetched diff only.
  useEffect(() => {
    if (!displayedDiffData) {
      setMergedChunksState(EMPTY_MERGED_CHUNKS_STATE);
      return;
    }

    setMergedChunksState(
      buildMergedChunksState(diffDataVersion, renderedFilePaths, filesByPath, (file) =>
        getMergedChunksRef.current(file),
      ),
    );
  }, [displayedDiffData, diffDataVersion, filesByPath, renderedFilePaths, lastUpdatedAt]);

  // Create files with merged chunks for keyboard navigation
  const navigableFiles = useMemo(() => {
    if (!displayedDiffData) return [];
    return displayedDiffData.files.map((file) => ({
      ...file,
      chunks:
        getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) || file.chunks,
    }));
  }, [displayedDiffData, diffDataVersion, mergedChunksState]);

  const fileLineIndexByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildFileLineIndex>>();
    navigableFiles.forEach((file) => {
      map.set(file.path, buildFileLineIndex(file));
    });
    return map;
  }, [navigableFiles]);

  const diffVisibleThreads = useMemo(
    () => reviewThreads.filter((thread) => !isHiddenInDiff(thread)),
    [reviewThreads],
  );
  const findingThreads = useMemo(() => reviewThreads.filter(isFindingThread), [reviewThreads]);
  const openFindingCounts = useMemo(() => countOpenFindingsByFile(reviewThreads), [reviewThreads]);
  const openFindingCount = useMemo(
    () => Array.from(openFindingCounts.values()).reduce((sum, count) => sum + count, 0),
    [openFindingCounts],
  );
  const findingCountByReviewer = useMemo(
    () => countFindingsByReviewer(reviewThreads),
    [reviewThreads],
  );
  const outputThreadCount = useMemo(
    () => selectThreadsForOutput(reviewThreads).length,
    [reviewThreads],
  );

  const normalizedThreads = useMemo<CommentThread[]>(
    () =>
      diffVisibleThreads.map((thread) => ({
        id: thread.id,
        file: thread.filePath,
        line:
          typeof thread.position.line === 'number'
            ? thread.position.line
            : ([thread.position.line.start, thread.position.line.end] as [number, number]),
        side: thread.position.side,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        codeContent: thread.codeSnapshot?.content,
        isOutdated: isThreadOutdated(thread, fileLineIndexByPath.get(thread.filePath)),
        messages: thread.messages,
      })),
    [diffVisibleThreads, fileLineIndexByPath],
  );
  const humanCommentThreads = useMemo(() => {
    const humanThreadIds = new Set(
      diffVisibleThreads
        .filter((thread) => getThreadKind(thread) === 'comment')
        .map((thread) => thread.id),
    );
    return normalizedThreads.filter((thread) => humanThreadIds.has(thread.id));
  }, [diffVisibleThreads, normalizedThreads]);
  const showAuthorBadges = useMemo(
    () => hasMultipleCommentAuthors(normalizedThreads.flatMap((thread) => thread.messages)),
    [normalizedThreads],
  );
  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    normalizedThreads.forEach((thread) => {
      const entry = map.get(thread.file);
      if (entry) {
        entry.push(thread);
      } else {
        map.set(thread.file, [thread]);
      }
    });
    return map;
  }, [normalizedThreads]);

  // State to trigger comment creation from keyboard
  const [commentTrigger, setCommentTrigger] = useState<{
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null>(null);
  const fetchDiffDataRef = useRef<((selection?: DiffSelection) => Promise<void>) | null>(null);
  const fetchCommitDiffRef = useRef<((hash: string) => Promise<void>) | null>(null);
  const handleWatchReload = useCallback(async () => {
    const commitHash = selectedCommitHashRef.current;
    await Promise.all([
      fetchDiffDataRef.current?.(),
      commitHash ? fetchCommitDiffRef.current?.(commitHash) : undefined,
    ]);
  }, []);
  const handleCommentsChanged = useCallback(async () => {
    try {
      const serverThreads = await fetchServerThreads();
      skipNextCommentSyncRef.current = true;
      replaceThreads(serverThreads);
      if (commentsContextKey) {
        setBootstrappedCommentsKey(commentsContextKey);
      }
    } catch (commentsError) {
      console.error('Failed to refresh comments from server:', commentsError);
    }
  }, [commentsContextKey, fetchServerThreads, replaceThreads]);

  const { overview, reviewers, handleReviewContextChanged } = useReviewContext();
  const hasReviewTabs = !isCommitView && (overview !== null || findingThreads.length > 0);
  const [selectedTab, setSelectedTab] = useState<ReviewTab | null>(null);
  const activeTab: ReviewTab = hasReviewTabs
    ? (selectedTab ?? (overview !== null ? 'overview' : 'files'))
    : 'files';
  const doneReviewerCount = reviewers.filter((reviewer) => reviewer.status === 'done').length;
  const isAnyReviewerRunning = doneReviewerCount < reviewers.length;

  useEffect(() => {
    if (!isAnyReviewerRunning || isApproved) return;

    const confirmLeaveWhileReviewing = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', confirmLeaveWhileReviewing);
    return () => window.removeEventListener('beforeunload', confirmLeaveWhileReviewing);
  }, [isAnyReviewerRunning, isApproved]);

  useEffect(() => {
    if (isApproved) window.close();
  }, [isApproved]);

  // File watch for reload functionality - initialize with callback
  const { shouldReload, reload, watchState } = useFileWatch(
    handleWatchReload,
    handleCommentsChanged,
    handleReviewContextChanged,
  );

  // Track which file the mouse is over so `v` works without a cursor
  const hoveredFileIndexRef = useRef<number | null>(null);
  const getHoveredFileIndex = useCallback(() => hoveredFileIndexRef.current, []);

  const { cursor, isHelpOpen, setIsHelpOpen, setCursorPosition, rememberFilePosition } =
    useKeyboardNavigation({
      files: navigableFiles,
      comments: normalizedThreads,
      viewMode: diffMode,
      reviewedFiles: viewedFiles,
      onToggleReviewed: toggleFileReviewed,
      getHoveredFileIndex,
      onCreateComment: () => {
        if (cursor && addCommentHandler) {
          setCommentTrigger({
            fileIndex: cursor.fileIndex,
            chunkIndex: cursor.chunkIndex,
            lineIndex: cursor.lineIndex,
          });
        }
      },
      onCopyAllComments: () => {
        if (reviewThreads.length > 0) {
          void handleCopyAllComments();
        }
      },
      onDeleteAllComments: () => {
        if (reviewThreads.length > 0 && confirm('Delete all comments?')) {
          clearAllComments();
        }
      },
      onShowCommentsList: () => {
        setIsCommentsListOpen(true);
      },
      onRefresh: () => {
        reload();
      },
    });

  // Viewed button in the diff header: silently remember the toggled file as
  // the navigation position, so keyboard navigation resumes from it without
  // showing any keyboard UI for a mouse interaction
  const handleViewedButtonToggle = useCallback(
    (filePath: string) => {
      void toggleFileReviewed(filePath);
      if (displayedDiffData) {
        const fileIndex = displayedDiffData.files.findIndex((f) => f.path === filePath);
        if (fileIndex !== -1) {
          rememberFilePosition(fileIndex);
        }
      }
    },
    [toggleFileReviewed, displayedDiffData, rememberFilePosition],
  );

  useEffect(() => {
    if (!displayedDiffData || !cursor) return;

    const filePath = displayedDiffData.files[cursor.fileIndex]?.path;
    if (!filePath || renderedFilePaths.has(filePath)) return;

    ensureFilesRenderedUpTo(filePath);
    requestAnimationFrame(() => {
      setCursorPosition(cursor);
    });
  }, [cursor, displayedDiffData, ensureFilesRenderedUpTo, renderedFilePaths, setCursorPosition]);

  const handleLineClick = useCallback(
    (fileIndex: number, chunkIndex: number, lineIndex: number, side: 'left' | 'right') => {
      setCursorPosition({
        fileIndex,
        chunkIndex,
        lineIndex,
        side,
      });
    },
    [setCursorPosition],
  );

  const handleCommentTriggerHandled = useCallback(() => {
    setCommentTrigger(null);
  }, [setCommentTrigger]);

  const handleGenerateThreadPrompt = useCallback(
    (thread: CommentThread) => generateThreadPrompt(thread.id),
    [generateThreadPrompt],
  );

  const startColumnResize = (e: React.MouseEvent, resize: (deltaX: number) => void) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      resize(moveEvent.clientX - startX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startWidth = sidebarWidth;
    startColumnResize(e, (deltaX) => setSidebarWidth(clampSidebarWidth(startWidth + deltaX)));
  };

  const handleSymbolPanelResizeStart = (e: React.MouseEvent) => {
    const startWidth = symbolPanelWidth;
    startColumnResize(e, (deltaX) =>
      setSymbolPanelWidth(clampSymbolPanelWidth(startWidth - deltaX)),
    );
  };

  const fetchDiffData = useCallback(
    async (selection?: DiffSelection) => {
      const requestId = diffRequestIdRef.current + 1;
      diffRequestIdRef.current = requestId;
      activeDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeDiffAbortControllerRef.current = controller;
      try {
        const requestedSelection =
          selection ??
          (hasUserSelectedRevisionRef.current ? selectedRevisionRef.current : undefined);
        const params = new URLSearchParams({
          ignoreWhitespace: String(ignoreWhitespace),
          showFullFile: String(showFullFile),
        });
        if (requestedSelection?.baseCommitish) params.set('base', requestedSelection.baseCommitish);
        if (requestedSelection?.targetCommitish)
          params.set('target', requestedSelection.targetCommitish);
        if (requestedSelection?.baseMode === 'merge-base')
          params.set('baseMode', requestedSelection.baseMode);

        const response = await fetch(`/api/diff?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to fetch diff data');
        const data = (await response.json()) as DiffResponse;
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setDiffData(data);
        setDiffDataVersion((prev) => prev + 1);

        // Update resolved revision state from server response
        setResolvedBaseRevision(
          data.baseCommitish && data.requestedBaseMode !== 'merge-base' ? data.baseCommitish : '',
        );
        if (data.targetCommitish) setResolvedTargetRevision(data.targetCommitish);

        if (!hasUserSelectedRevisionRef.current) {
          const requestedBase = data.requestedBaseCommitish ?? data.baseCommitish;
          const requestedTarget = data.requestedTargetCommitish ?? data.targetCommitish;
          if (requestedBase && requestedTarget) {
            setSelectedRevision(
              createDiffSelection(requestedBase, requestedTarget, data.requestedBaseMode),
            );
          }
        }

        // Lock files are now automatically marked as viewed by useViewedFiles hook
      } catch (err) {
        if (isAbortError(err) || diffRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (activeDiffAbortControllerRef.current === controller) {
          activeDiffAbortControllerRef.current = null;
        }
        if (diffRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [ignoreWhitespace, showFullFile],
  );
  fetchDiffDataRef.current = fetchDiffData;

  const fetchCommitDiff = useCallback(
    async (hash: string) => {
      const requestId = commitDiffRequestIdRef.current + 1;
      commitDiffRequestIdRef.current = requestId;
      activeCommitDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeCommitDiffAbortControllerRef.current = controller;
      let nextCommitDiffData: DiffResponse | null = null;
      try {
        const params = new URLSearchParams({
          hash,
          ignoreWhitespace: String(ignoreWhitespace),
          showFullFile: String(showFullFile),
        });
        const response = await fetch(`/api/commit-diff?${params}`, { signal: controller.signal });
        if (response.ok) {
          nextCommitDiffData = (await response.json()) as DiffResponse;
        }
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
      } finally {
        if (activeCommitDiffAbortControllerRef.current === controller) {
          activeCommitDiffAbortControllerRef.current = null;
        }
      }
      if (commitDiffRequestIdRef.current !== requestId) {
        return;
      }
      // A failed fetch (e.g. the commit left the range after a rebase) falls back to the whole diff.
      setCommitDiffData(nextCommitDiffData);
      setDiffDataVersion((prev) => prev + 1);
    },
    [ignoreWhitespace, showFullFile],
  );
  fetchCommitDiffRef.current = fetchCommitDiff;

  const showWholeDiff = useCallback(() => {
    commitDiffRequestIdRef.current += 1;
    activeCommitDiffAbortControllerRef.current?.abort();
    setCommitDiffData(null);
    setDiffDataVersion((prev) => prev + 1);
  }, []);

  useEffect(() => {
    void fetchDiffData();
  }, [fetchDiffData]);

  useEffect(() => {
    const commitHash = selectedCommitHashRef.current;
    if (commitHash) {
      void fetchCommitDiff(commitHash);
    }
  }, [fetchCommitDiff]);

  useEffect(() => {
    return () => {
      activeDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      activeCommitDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isMobile && diffMode !== 'unified') {
      setDiffMode('unified');
    }
  }, [diffMode, isMobile]);

  // Hydrate UI settings from the server-persisted config so they survive
  // across ports (localStorage is origin-scoped and resets on a new port).
  // Settings the server doesn't know yet are seeded from localStorage.
  useEffect(() => {
    let cancelled = false;

    void fetchClientSettings().then((client) => {
      if (cancelled || !client) {
        return;
      }

      const seed: Record<string, unknown> = {};

      const remoteDiffViewMode = parseDiffViewMode(client.diffViewMode);
      if (remoteDiffViewMode) {
        setDiffMode(remoteDiffViewMode);
      } else {
        const localDiffViewMode = getStoredDiffViewMode();
        if (localDiffViewMode) {
          seed.diffViewMode = localDiffViewMode;
        }
      }

      if (typeof client.sidebarWidth === 'number' && Number.isFinite(client.sidebarWidth)) {
        setSidebarWidth(clampSidebarWidth(client.sidebarWidth));
      } else {
        const localSidebarWidth = getStoredSidebarWidth();
        if (localSidebarWidth !== null) {
          seed.sidebarWidth = localSidebarWidth;
        }
      }

      if (typeof client.sidebarOpen === 'boolean') {
        setIsFileTreeOpen(client.sidebarOpen);
      } else {
        const localSidebarOpen = getStoredBoolean(SIDEBAR_OPEN_STORAGE_KEY);
        if (localSidebarOpen !== null) {
          seed.sidebarOpen = localSidebarOpen;
        }
      }

      if (typeof client.showFullFile === 'boolean') {
        setShowFullFile(client.showFullFile);
      } else {
        const localShowFullFile = getStoredBoolean(SHOW_FULL_FILE_STORAGE_KEY);
        if (localShowFullFile !== null) {
          seed.showFullFile = localShowFullFile;
        }
      }

      if (Object.keys(seed).length > 0) {
        saveClientSettings(seed);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const skipInitialSidebarWidthSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    // Skip the mount run so simply opening difit doesn't write the config file.
    if (skipInitialSidebarWidthSaveRef.current) {
      skipInitialSidebarWidthSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarWidth });
  }, [sidebarWidth]);

  const skipInitialSidebarOpenSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(isFileTreeOpen));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    if (skipInitialSidebarOpenSaveRef.current) {
      skipInitialSidebarOpenSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarOpen: isFileTreeOpen });
  }, [isFileTreeOpen]);

  // Fetch revision options on mount
  useEffect(() => {
    fetch('/api/revisions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RevisionsResponse | null) => {
        setRevisionOptions(data);
        if (
          data?.resolvedBase &&
          normalizeBaseMode(currentRequestedBaseModeRef.current) !== 'merge-base'
        ) {
          setResolvedBaseRevision((prev) => prev || data.resolvedBase || '');
        }
        if (data?.resolvedTarget) {
          setResolvedTargetRevision((prev) => prev || data.resolvedTarget || '');
        }
      })
      .catch(() => setRevisionOptions(null));
  }, []);

  // Handle revision change
  const handleRevisionChange = useCallback(
    async (nextSelection: DiffSelection) => {
      // Skip if no actual change
      if (diffSelectionsEqual(nextSelection, selectedRevision)) return;

      hasUserSelectedRevisionRef.current = true;
      selectedRevisionRef.current = nextSelection;
      setSelectedRevision(nextSelection);
      showWholeDiff();
      setLoading(true);
      setError(null);
      await fetchDiffData(nextSelection);
    },
    [fetchDiffData, selectedRevision, showWholeDiff],
  );

  const handleCommitScopeChange = useCallback(
    (hash: string | null) => {
      if (hash) {
        void fetchCommitDiff(hash);
      } else {
        showWholeDiff();
      }
    },
    [fetchCommitDiff, showWholeDiff],
  );

  const rangeCommits = useRangeCommits(resolvedSelectionKey);
  const canSwitchCommits = rangeCommits.length > 1;

  const selectAdjacentCommit = useCallback(
    (step: 1 | -1) => {
      if (!canSwitchCommits) return;
      const scopeHashes = [null, ...rangeCommits.map((commit) => commit.hash)];
      const nextHash = scopeHashes[scopeHashes.indexOf(selectedCommitHashRef.current) + step];
      if (nextHash !== undefined) {
        handleCommitScopeChange(nextHash);
      }
    },
    [canSwitchCommits, handleCommitScopeChange, rangeCommits],
  );
  // [ and ] already move between files, so commits use Shift with the j/k next/previous convention.
  const commitHotkeyOptions = {
    scopes: 'navigation',
    enableOnFormTags: false,
    preventDefault: true,
  };
  useHotkeys('shift+j', () => selectAdjacentCommit(1), commitHotkeyOptions, [selectAdjacentCommit]);
  useHotkeys('shift+k', () => selectAdjacentCommit(-1), commitHotkeyOptions, [
    selectAdjacentCommit,
  ]);

  // Clear comments and viewed files on initial load if requested via CLI flag
  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      pendingBootstrapAfterLocalResetRef.current = true;
      clearAllComments({ resetAppliedCommentImportIds: true });
      clearViewedFiles();
      console.log(
        '✅ All existing comments and viewed files cleared as requested via --clean flag',
      );
    }
  }, [diffData?.clearComments, clearAllComments, clearViewedFiles]);

  useEffect(() => {
    if (!commentsContextKey || !hasLoadedComments) {
      return;
    }

    if (bootstrappedCommentsKey === commentsContextKey) {
      return;
    }

    if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
      return;
    }

    const shouldReplaceFromServer = pendingBootstrapAfterLocalResetRef.current;
    pendingBootstrapAfterLocalResetRef.current = false;

    bootstrappingCommentsKeyRef.current = commentsContextKey;
    let cancelled = false;

    const bootstrapComments = async () => {
      try {
        const serverThreads = await fetchServerThreads();
        const nextThreads = shouldReplaceFromServer
          ? serverThreads
          : preserveServerFindingHistory(
              serverThreads,
              mergeCommentThreads(serverThreads, threads).threads,
            );
        if (cancelled) {
          return;
        }

        skipNextCommentSyncRef.current = true;
        replaceThreads(nextThreads);

        if (
          !shouldReplaceFromServer &&
          JSON.stringify(serverThreads) !== JSON.stringify(nextThreads)
        ) {
          await syncThreadsToServer(nextThreads);
        }
      } catch (commentsError) {
        if (!cancelled) {
          console.error('Failed to bootstrap comments from server:', commentsError);
        }
      } finally {
        if (!cancelled) {
          setBootstrappedCommentsKey(commentsContextKey);
        }
        if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
          bootstrappingCommentsKeyRef.current = null;
        }
      }
    };

    void bootstrapComments();

    return () => {
      cancelled = true;
      if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
        bootstrappingCommentsKeyRef.current = null;
      }
    };
  }, [
    bootstrappedCommentsKey,
    commentsContextKey,
    fetchServerThreads,
    hasLoadedComments,
    replaceThreads,
    syncThreadsToServer,
    threads,
  ]);

  // Trigger sparkle animation when all files are viewed
  useEffect(() => {
    if (diffData) {
      // Reset the trigger flag when not all files are viewed
      if (viewedFiles.size < diffData.files.length) {
        setHasTriggeredSparkles(false);
      }
      // Show sparkles when all files are viewed and not already triggered
      else if (viewedFiles.size === diffData.files.length && !hasTriggeredSparkles) {
        setShowSparkles(true);
        setHasTriggeredSparkles(true);
        // Hide sparkles after animation completes
        setTimeout(() => {
          setShowSparkles(false);
        }, 1000);
      }
    }
  }, [viewedFiles.size, diffData, hasTriggeredSparkles]);

  // Send comments to server whenever they change and before page unload
  useEffect(() => {
    if (!hasBootstrappedComments || isApproved) {
      return;
    }

    const data = serializeCommentsPayload(threads);
    const commentsApiUrl = getCommentApiUrl('/api/comments');

    // Also handle page unload
    const sendCommentsBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload, including empty states.
      navigator.sendBeacon(commentsApiUrl, data);
    };

    window.addEventListener('beforeunload', sendCommentsBeforeUnload);

    if (skipNextCommentSyncRef.current) {
      skipNextCommentSyncRef.current = false;
      return () => {
        window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
      };
    }

    syncThreadsToServer(threads).catch((syncError) => {
      console.error('Failed to sync comments:', syncError);
    });

    return () => {
      window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
    };
  }, [
    getCommentApiUrl,
    hasBootstrappedComments,
    isApproved,
    serializeCommentsPayload,
    syncThreadsToServer,
    threads,
  ]);

  // Establish SSE connection for tab close detection
  useEffect(() => {
    const eventSource = new EventSource(resolveEventSourceUrl('/api/heartbeat'));

    eventSource.onopen = () => {
      console.log('Connected to server heartbeat');
    };

    eventSource.onerror = () => {
      console.log('Server connection lost');
      eventSource.close();
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  const handleAddComment = useCallback(
    (
      file: string,
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
    ): Promise<void> => {
      addThread({
        filePath: file,
        body,
        side: side || 'new',
        line: typeof line === 'number' ? line : { start: line[0], end: line[1] },
        codeSnapshot:
          codeContent !== undefined
            ? {
                content: codeContent,
                language: undefined,
              }
            : undefined,
      });
      return Promise.resolve();
    },
    [addThread],
  );
  const addCommentHandler = isCommitView ? undefined : handleAddComment;

  const handleCopyAllComments = async () => {
    try {
      const prompt = generateAllCommentsPrompt({
        requestedBaseCommitish: diffData?.requestedBaseCommitish,
        requestedTargetCommitish: diffData?.requestedTargetCommitish,
        baseMode: normalizeBaseMode(diffData?.requestedBaseMode),
        resolvedBaseCommitish: diffData?.baseCommitish,
        resolvedTargetCommitish: diffData?.targetCommitish,
      });
      await copyTextToClipboard(prompt);
      setIsCopiedAll(true);
      setTimeout(() => setIsCopiedAll(false), 2000);
    } catch (error) {
      console.error('Failed to copy all comments prompt:', error);
    }
  };

  const handleApprove = async () => {
    if (
      isAnyReviewerRunning &&
      !window.confirm('AI reviewers are still running. Approve and end the review anyway?')
    ) {
      return;
    }

    setApproveStatus('pending');
    try {
      const response = await fetch(getCommentApiUrl('/api/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeCommentsPayload(threads),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      setApproveStatus('approved');
    } catch (approveFailure) {
      console.error('Failed to approve review:', approveFailure);
      setApproveStatus('failed');
    }
  };

  const handleReplyToThread = useCallback(
    (threadId: string, body: string): Promise<void> => {
      replyToThread({ threadId, body });
      return Promise.resolve();
    },
    [replyToThread],
  );

  const handleNavigateToComment = (thread: CommentThread) => {
    if (!displayedDiffData) return;

    const position = findCommentPosition(thread, displayedDiffData.files);
    if (position) {
      setCursorPosition(position);
    }
  };

  const showLineInDiff = useCallback(
    (filePath: string, line: number, side: DiffSide = 'new') => {
      if (!displayedDiffData) return;

      const fileIndex = displayedDiffData.files.findIndex((file) => file.path === filePath);
      const file = displayedDiffData.files[fileIndex];
      if (!file) return;

      const position =
        findLinePosition(file, fileIndex, line, side) ??
        findLinePosition(file, fileIndex, line, side === 'new' ? 'old' : 'new');
      setSelectedTab('files');
      requestAnimationFrame(() => {
        if (position) {
          setCursorPosition(position);
        } else {
          scrollFileIntoDiffContainer(filePath);
        }
      });
    },
    [displayedDiffData, scrollFileIntoDiffContainer, setCursorPosition],
  );

  const handleNavigateToFinding = useCallback(
    (threadId: string) => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) return;
      const { line, side } = thread.position;
      showLineInDiff(thread.filePath, typeof line === 'number' ? line : line.end, side);
    },
    [showLineInDiff, threads],
  );

  const isFileInDiff = useCallback((filePath: string) => filesByPath.has(filePath), [filesByPath]);

  const symbolNavigation = useSymbolNavigation();
  const { lookup: lookupSymbol } = symbolNavigation;
  const lspStatus =
    symbolNavigation.status?.enabled && !isCommitView ? symbolNavigation.status : null;
  const isSymbolPanelOpen =
    symbolNavigation.current !== null ||
    symbolNavigation.isLoading ||
    symbolNavigation.error !== null;

  const handleSymbolClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (!lspStatus || !(e.metaKey || e.ctrlKey)) return;
      const target = findSymbolTarget(e);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      void lookupSymbol(target);
    },
    [lspStatus, lookupSymbol],
  );

  const getFirstChangeElementId = useCallback(
    (filePath: string) => {
      if (collapsedFiles.has(filePath)) return undefined;
      const fileIndex = navigableFiles.findIndex((file) => file.path === filePath);
      const file = navigableFiles[fileIndex];
      if (!file || getViewerForFile(file).id !== 'default') return undefined;
      const position = findFirstChangePosition(file, fileIndex);
      return position ? getElementId(position, diffMode) : undefined;
    },
    [collapsedFiles, diffMode, navigableFiles],
  );

  const handleScrollToFile = useCallback(
    (filePath: string) => {
      const lineElementId = getFirstChangeElementId(filePath);
      if (activeTab === 'files') {
        scrollFileIntoDiffContainer(filePath, lineElementId);
        return;
      }
      setSelectedTab('files');
      requestAnimationFrame(() => scrollFileIntoDiffContainer(filePath, lineElementId));
    },
    [activeTab, getFirstChangeElementId, scrollFileIntoDiffContainer],
  );

  const handleOpenInEditor = useCallback(
    async (filePath: string, lineNumber: number) => {
      try {
        const response = await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath,
            line: lineNumber,
            editor: settings.editor,
          }),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          let message = response.statusText;
          if (
            payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof (payload as { error?: unknown }).error === 'string'
          ) {
            message = (payload as { error: string }).error;
          }
          console.error('Failed to open file in editor:', message);
        }
      } catch (error) {
        console.error('Failed to open file in editor:', error);
      }
    },
    [settings.editor],
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    // Clear cursor position
    setCursorPosition(null);

    // Check if clicking on a comment button
    const target = e.target as HTMLElement;
    const isCommentButton = target.closest('[data-comment-button="true"]');
    const isOpenInEditorButton = target.closest('[data-open-in-editor-button="true"]');
    const isShiftRangeClick = e.shiftKey && target.closest('[data-diff-line-row="true"]');

    // Close empty comment forms (unless clicking on a comment button)
    if (!isCommentButton && !isOpenInEditorButton && !isShiftRangeClick) {
      closeEmptyCommentForms(e);
    }
  };

  const closeEmptyCommentForms = (e: React.MouseEvent) => {
    const emptyForms = document.querySelectorAll('form[data-empty="true"]');
    emptyForms.forEach((form) => {
      // Don't close if clicking inside the form itself
      if (!form.contains(e.target as Node)) {
        const cancelButton = form.querySelector<HTMLButtonElement>('[data-comment-cancel="true"]');
        cancelButton?.click();
      }
    });
  };

  if (isApproved) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-accent text-2xl mb-2">Approved</h2>
        <p className="text-github-text-secondary text-base">You can close this tab.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-github-bg-primary">
        <div className="text-github-text-secondary text-base">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">Error</h2>
        <p className="text-github-text-secondary text-base">{error}</p>
      </div>
    );
  }

  if (!diffData || !displayedDiffData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">No data</h2>
        <p className="text-github-text-secondary text-base">No diff data available</p>
      </div>
    );
  }

  const canOpenInEditor =
    displayedDiffData.openInEditorAvailable !== false &&
    settings.editor.id !== 'none' &&
    settings.editor.command.trim() !== '' &&
    settings.editor.argsTemplate.trim() !== '';

  const appContent = (
    <WordHighlightProvider>
      <div className="h-screen flex flex-col" onClickCapture={handleGlobalClick}>
        <header
          className={`bg-github-bg-secondary border-b border-github-border flex ${
            isMobile ? 'flex-col' : 'flex-row items-center'
          }`}
        >
          <div
            className={`flex items-center justify-between w-full ${
              isMobile ? 'px-3 py-2 gap-3' : 'px-4 py-3 gap-4 w-auto'
            } ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '100%' : isFileTreeOpen ? `${sidebarWidth}px` : 'auto',
              minWidth: isMobile ? '0px' : isFileTreeOpen ? '200px' : 'auto',
              maxWidth: isMobile ? 'none' : isFileTreeOpen ? '600px' : 'none',
            }}
          >
            <h1>
              <Logo
                style={{
                  height: '18px',
                  color: 'var(--color-github-text-secondary)',
                }}
              />
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsFileTreeOpen(!isFileTreeOpen)}
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title={isFileTreeOpen ? 'Collapse file tree' : 'Expand file tree'}
                aria-expanded={isFileTreeOpen}
                aria-controls="file-tree-panel"
                aria-label="Toggle file tree panel"
              >
                {isFileTreeOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
          {!isMobile && (
            <div
              className={`border-r border-github-border ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
                height: 'calc(100% - 16px)',
                margin: '8px 0',
                transform: 'translateX(-2px)',
              }}
            />
          )}
          <div
            className={`flex-1 flex flex-wrap items-center justify-between ${
              isMobile ? 'px-3 pb-2 gap-3' : 'px-4 py-3 gap-4'
            }`}
          >
            <div className={`flex flex-wrap items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
              {!isMobile && (
                <div className="flex bg-github-bg-tertiary border border-github-border rounded-md p-1">
                  <button
                    onClick={() => handleDiffModeChange('split')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'split'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <Columns size={14} />
                    Split
                  </button>
                  <button
                    onClick={() => handleDiffModeChange('unified')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'unified'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <AlignLeft size={14} />
                    Unified
                  </button>
                </div>
              )}
              <Checkbox
                checked={ignoreWhitespace}
                onChange={setIgnoreWhitespace}
                label="Ignore Whitespace"
                title={ignoreWhitespace ? 'Show whitespace changes' : 'Ignore whitespace changes'}
              />
              <Checkbox
                checked={showFullFile}
                onChange={handleShowFullFileChange}
                label="Show Full File"
                title={showFullFile ? 'Collapse unchanged lines' : 'Show full file'}
              />
              {/* File Watch Reload Button */}
              <ReloadButton
                shouldReload={shouldReload}
                isReloading={watchState.isReloading}
                onReload={reload}
                changeType={watchState.lastChangeType}
                compact={isMobile}
              />
            </div>
            <div
              className={`flex flex-wrap items-center text-sm text-github-text-secondary ${
                isMobile ? 'gap-3' : 'gap-4'
              }`}
            >
              {isAnyReviewerRunning && (
                <span className="text-xs text-github-warning">
                  Reviewing {doneReviewerCount}/{reviewers.length}
                </span>
              )}
              {!isMobile && reviewThreads.length > 0 && (
                <CommentsDropdown
                  commentsCount={outputThreadCount}
                  isCopiedAll={isCopiedAll}
                  onCopyAll={handleCopyAllComments}
                  onDeleteAll={clearAllComments}
                  onViewAll={() => setIsCommentsListOpen(true)}
                />
              )}
              {!isCommitView && (
                <div className="flex flex-col gap-1 items-center">
                  <div className="text-xs relative">
                    {viewedFiles.size === diffData.files.length
                      ? 'All diffs viewed!'
                      : `${viewedFiles.size} / ${diffData.files.length} files viewed`}
                    <SparkleAnimation isActive={showSparkles} />
                  </div>
                  <div
                    className="relative h-2 bg-github-bg-tertiary rounded-full overflow-hidden"
                    style={{
                      width: '90px',
                      border: '1px solid var(--color-github-border)',
                    }}
                  >
                    <div
                      className="absolute top-0 right-0 h-full transition-all duration-300 ease-out"
                      style={{
                        width: `${((diffData.files.length - viewedFiles.size) / diffData.files.length) * 100}%`,
                        backgroundColor: (() => {
                          const remainingPercent =
                            ((diffData.files.length - viewedFiles.size) / diffData.files.length) *
                            100;
                          if (remainingPercent > 50) return 'var(--color-github-accent)'; // green
                          if (remainingPercent > 20) return 'var(--color-github-warning)'; // yellow
                          return 'var(--color-github-danger)'; // red
                        })(),
                      }}
                    />
                  </div>
                </div>
              )}
              {revisionOptions ? (
                <DiffQuickMenu
                  options={revisionOptions}
                  selection={selectedRevision}
                  resolvedBaseRevision={resolvedBaseRevision}
                  resolvedTargetRevision={resolvedTargetRevision}
                  onSelectDiff={(selection) => void handleRevisionChange(selection)}
                  onOpenAdvanced={() => setIsRevisionModalOpen(true)}
                  compact={!isDesktop}
                />
              ) : (
                <span className="text-xs">
                  Reviewing:{' '}
                  <code className="bg-github-bg-tertiary px-1.5 py-0.5 rounded text-xs text-github-text-primary">
                    {displayedDiffData.commit.includes('...') ? (
                      <>
                        <span className="text-github-text-secondary font-medium">
                          {displayedDiffData.commit.split('...')[0]}...
                        </span>
                        <span className="font-medium">
                          {displayedDiffData.commit.split('...')[1]}
                        </span>
                      </>
                    ) : (
                      displayedDiffData.commit
                    )}
                  </code>
                </span>
              )}
              {isCommitView && (
                <span
                  className="flex items-center gap-1 text-xs text-github-warning"
                  title="Viewing one commit. Choose All changes under Commits to comment or approve."
                >
                  <Lock size={12} aria-hidden="true" />
                  Read-only
                </span>
              )}
              {displayedDiffData.approveAvailable !== false && (
                <div className="flex items-center gap-2">
                  {approveStatus === 'failed' && (
                    <span role="alert" className="text-xs text-github-danger">
                      Failed to approve. Please try again.
                    </span>
                  )}
                  <button
                    onClick={() => void handleApprove()}
                    disabled={approveStatus === 'pending'}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-github-accent text-white hover:bg-github-accent/90 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Approve and end the review"
                  >
                    <Check size={14} />
                    Approve
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {revisionOptions && (
          <RevisionDetailModal
            key={isRevisionModalOpen ? getDiffSelectionKey(selectedRevision) : 'closed'}
            isOpen={isRevisionModalOpen}
            onClose={() => setIsRevisionModalOpen(false)}
            options={revisionOptions}
            selection={selectedRevision}
            resolvedBaseRevision={resolvedBaseRevision}
            resolvedTargetRevision={resolvedTargetRevision}
            onApply={(selection) => void handleRevisionChange(selection)}
          />
        )}

        {hasReviewTabs && (
          <ReviewTabs
            activeTab={activeTab}
            findingCount={openFindingCount}
            onChange={setSelectedTab}
          />
        )}

        {isMobile && isFileTreeOpen && (
          <button
            type="button"
            aria-label="Close file tree"
            className="fixed inset-0 bg-black/40 z-30"
            onClick={() => setIsFileTreeOpen(false)}
          />
        )}

        <div className="flex flex-1 overflow-hidden relative">
          <div
            className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '0px' : isFileTreeOpen ? `${sidebarWidth}px` : '0px',
            }}
          >
            <aside
              id="file-tree-panel"
              className={`bg-github-bg-secondary overflow-y-auto flex flex-col ${
                isMobile
                  ? 'fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] border-l border-github-border transition-transform duration-300 ease-out'
                  : 'relative border-r border-github-border'
              }`}
              style={{
                width: isMobile ? 'min(85vw, 360px)' : `${sidebarWidth}px`,
                minWidth: isMobile ? '0px' : '200px',
                maxWidth: isMobile ? 'none' : '600px',
                height: '100%',
                transform: isMobile
                  ? isFileTreeOpen
                    ? 'translateX(0)'
                    : 'translateX(100%)'
                  : undefined,
              }}
            >
              {canSwitchCommits && (
                <CommitScopeSelector
                  commits={rangeCommits}
                  selectedHash={selectedCommitHash}
                  onSelect={handleCommitScopeChange}
                />
              )}
              <div className="flex-1 overflow-y-auto">
                <FileList
                  files={displayedDiffData.files}
                  onScrollToFile={handleScrollToFile}
                  onFileSelected={isMobile ? handleMobileFileSelected : undefined}
                  comments={humanCommentThreads}
                  findingCounts={openFindingCounts}
                  reviewedFiles={viewedFiles}
                  onToggleReviewed={toggleFileReviewed}
                  onToggleFolderReviewed={toggleFolderReviewed}
                  selectedFileIndex={cursor?.fileIndex ?? null}
                />
              </div>
              {!isMobile && (
                <div className="p-4 border-t border-github-border flex justify-between items-center">
                  <button
                    onClick={() => setIsHelpOpen(true)}
                    className="flex items-center gap-1.5 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="Keyboard shortcuts (Shift+?)"
                  >
                    <Keyboard size={16} />
                    <span className="text-sm">Shortcuts</span>
                  </button>
                  <a
                    href="https://github.com/yoshiko-pg/difit"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="View on GitHub"
                  >
                    <span className="text-sm">Star on GitHub</span>
                    <GitHubIcon style={{ height: '18px', width: '18px' }} />
                  </a>
                </div>
              )}
            </aside>
          </div>

          {!isMobile && (
            <div
              className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
              }}
              onMouseDown={handleMouseDown}
              title="Drag to resize file list"
            />
          )}

          {activeTab === 'overview' && (
            <div className="flex-1 overflow-y-auto">
              <OverviewPanel
                markdown={overview}
                reviewers={reviewers}
                findingCountByReviewer={findingCountByReviewer}
                isFileInDiff={isFileInDiff}
                onOpenFileReference={showLineInDiff}
                syntaxTheme={settings.syntaxTheme}
              />
            </div>
          )}
          {activeTab === 'findings' && (
            <div className="flex-1 overflow-y-auto">
              <FindingsPanel
                threads={findingThreads}
                onNavigate={handleNavigateToFinding}
                onSetFindingDecision={setFindingDecision}
              />
            </div>
          )}
          <main
            ref={diffScrollContainerRef}
            className={`flex-1 overflow-y-auto ${showMobileCommentsBar ? 'pb-16' : ''} ${
              activeTab === 'files' ? '' : 'hidden'
            }`}
            onClickCapture={handleSymbolClickCapture}
          >
            {displayedDiffData.files.map((file, fileIndex) => {
              const fileThreads = threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS;
              const mergedChunks =
                getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) ??
                EMPTY_MERGED_CHUNKS;
              const isRendered = renderedFilePaths.has(file.path);
              return (
                <div
                  key={file.path}
                  id={getFileElementId(file.path)}
                  data-file-path={file.path}
                  data-rendered={isRendered ? 'true' : 'false'}
                  ref={(node) => registerLazyFileContainer(file.path, node)}
                  className="mb-6"
                  onMouseEnter={() => {
                    hoveredFileIndexRef.current = fileIndex;
                  }}
                  onMouseLeave={() => {
                    if (hoveredFileIndexRef.current === fileIndex) {
                      hoveredFileIndexRef.current = null;
                    }
                  }}
                >
                  {isRendered ? (
                    <DiffViewer
                      file={file}
                      threads={fileThreads}
                      showAuthorBadges={showAuthorBadges}
                      diffMode={diffMode}
                      reviewedFiles={viewedFiles}
                      isChangedSinceViewed={changedSinceViewedFiles.has(file.path)}
                      onToggleReviewed={handleViewedButtonToggle}
                      collapsedFiles={collapsedFiles}
                      onToggleCollapsed={toggleFileCollapsed}
                      onToggleAllCollapsed={toggleAllFilesCollapsed}
                      onAddComment={addCommentHandler}
                      onGenerateThreadPrompt={handleGenerateThreadPrompt}
                      onRemoveThread={removeThread}
                      onReplyToThread={handleReplyToThread}
                      onRemoveMessage={removeMessage}
                      onUpdateMessage={updateMessage}
                      onOpenInEditor={canOpenInEditor ? handleOpenInEditor : undefined}
                      syntaxTheme={settings.syntaxTheme}
                      baseCommitish={displayedDiffData.baseCommitish}
                      targetCommitish={displayedDiffData.targetCommitish}
                      cursor={cursor?.fileIndex === fileIndex ? cursor : null}
                      isFocused={cursor?.fileIndex === fileIndex}
                      fileIndex={fileIndex}
                      onLineClick={handleLineClick}
                      commentTrigger={
                        commentTrigger?.fileIndex === fileIndex ? commentTrigger : null
                      }
                      onCommentTriggerHandled={handleCommentTriggerHandled}
                      mergedChunks={mergedChunks}
                      expandLines={expandLines}
                      expandAllBetweenChunks={expandAllBetweenChunks}
                      prefetchFileContent={prefetchFileContent}
                      isExpandLoading={isExpandLoading}
                      diffVersion={diffDataVersion}
                    />
                  ) : (
                    <div
                      className="[overflow-anchor:none]"
                      style={{
                        height: estimateFileHeight(file, diffMode, collapsedFiles.has(file.path)),
                      }}
                    >
                      <div className="bg-github-bg-secondary border border-github-border rounded-md px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wide text-github-text-muted">
                              Deferred Rendering
                            </div>
                            <div className="text-sm font-mono text-github-text-primary truncate">
                              {file.path}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => ensureFileRendered(file.path)}
                            className="px-3 py-1.5 text-xs rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary"
                          >
                            Load now
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </main>
          {activeTab === 'files' && !isMobile && (
            <DiffMinimap
              scrollContainerRef={diffScrollContainerRef}
              files={displayedDiffData.files}
              threads={diffVisibleThreads}
              collapsedFiles={collapsedFiles}
            />
          )}
          {activeTab === 'files' && lspStatus && isSymbolPanelOpen && (
            <>
              <div
                className="w-1 shrink-0 cursor-col-resize bg-github-border hover:bg-github-text-muted"
                onMouseDown={handleSymbolPanelResizeStart}
                title="Drag to resize symbol panel"
              />
              <SymbolPanel
                status={lspStatus}
                current={symbolNavigation.current}
                view={symbolNavigation.view}
                isLoading={symbolNavigation.isLoading}
                error={symbolNavigation.error}
                canGoBack={symbolNavigation.canGoBack}
                width={symbolPanelWidth}
                syntaxTheme={settings.syntaxTheme}
                onOpenLocation={symbolNavigation.open}
                onShowInDiff={showLineInDiff}
                onBack={symbolNavigation.back}
                onClose={symbolNavigation.close}
              />
            </>
          )}
        </div>

        {showMobileCommentsBar && (
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-github-bg-secondary border-t border-github-border px-4 py-2 flex justify-end">
            <CommentsDropdown
              commentsCount={outputThreadCount}
              isCopiedAll={isCopiedAll}
              onCopyAll={handleCopyAllComments}
              onDeleteAll={clearAllComments}
              onViewAll={() => setIsCommentsListOpen(true)}
              direction="up"
              compact
            />
          </div>
        )}

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSettingsChange={updateSettings}
          />
        )}

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

        <CommentsListModal
          isOpen={isCommentsListOpen}
          onClose={() => setIsCommentsListOpen(false)}
          onNavigate={handleNavigateToComment}
          comments={normalizedThreads}
          showAuthorBadges={showAuthorBadges}
          onRemoveThread={removeThread}
          onGenerateThreadPrompt={handleGenerateThreadPrompt}
          onReplyToThread={handleReplyToThread}
          onRemoveMessage={removeMessage}
          onUpdateMessage={updateMessage}
          syntaxTheme={settings.syntaxTheme}
        />
      </div>
    </WordHighlightProvider>
  );

  return (
    <ReviewThreadProvider threads={threads} onSetFindingDecision={setFindingDecision}>
      {appContent}
    </ReviewThreadProvider>
  );
}

export default App;
