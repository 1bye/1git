import type { FileDiffMetadata } from "@pierre/diffs";
import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { REPOSITORY_DIFF_EXPANDABLE_CONTEXT_LINES } from "@/fixture/repository-workspace/constants/repository-diff.js";
import {
	createExpandableRepositoryDiffFile,
	type RepositoryDiffFileEntry,
} from "@/fixture/repository-workspace/lib/repository-diff-files.js";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface ExpandableDiffFileState {
	readonly contentKey: string;
	readonly files: ReadonlyMap<string, FileDiffMetadata>;
}

interface UseExpandableRepositoryDiffFilesResult {
	readonly files: ReadonlyMap<string, FileDiffMetadata>;
	readonly requestFile: (
		entry: RepositoryDiffFileEntry
	) => Promise<FileDiffMetadata | null>;
}

const EMPTY_EXPANDED_FILES = new Map<string, FileDiffMetadata>();

export const useExpandableRepositoryDiffFiles = (
	sessionId: RepositorySessionId,
	contentKey: string,
	ignoreWhitespace: boolean
): UseExpandableRepositoryDiffFilesResult => {
	const [state, setState] = useState<ExpandableDiffFileState>({
		contentKey,
		files: EMPTY_EXPANDED_FILES,
	});

	const pendingRequestsRef = useRef(
		new Map<string, Promise<FileDiffMetadata | null>>()
	);

	const files =
		state.contentKey === contentKey ? state.files : EMPTY_EXPANDED_FILES;

	const filesRef = useRef(files);

	useEffect(() => {
		filesRef.current = files;
	}, [files]);
	const requestFile = useCallback(
		async (
			entry: RepositoryDiffFileEntry
		): Promise<FileDiffMetadata | null> => {
			const loadedFile = filesRef.current.get(entry.key);

			if (loadedFile) {
				return loadedFile;
			}

			const requestKey = `${sessionId}:${contentKey}:${entry.key}`;
			const pendingRequest = pendingRequestsRef.current.get(requestKey);

			if (pendingRequest) {
				return await pendingRequest;
			}

			const request = (async (): Promise<FileDiffMetadata | null> => {
				const result = await window.desktop.git.repository.diff(sessionId, {
					contextLines: REPOSITORY_DIFF_EXPANDABLE_CONTEXT_LINES,
					ignoreWhitespace,
					paths: [entry.path],
					target: entry.target,
				});

				if (!result.ok) {
					return null;
				}

				const file = createExpandableRepositoryDiffFile(
					result.value,
					entry.path,
					`${entry.key}:expanded`
				);

				if (!file) {
					return null;
				}

				startTransition(() => {
					setState((current) => {
						const currentFiles =
							current.contentKey === contentKey
								? current.files
								: EMPTY_EXPANDED_FILES;

						const nextFiles = new Map(currentFiles);

						nextFiles.set(entry.key, file);

						return {
							contentKey,
							files: nextFiles,
						};
					});
				});

				return file;
			})();

			pendingRequestsRef.current.set(requestKey, request);

			try {
				return await request;
			} finally {
				pendingRequestsRef.current.delete(requestKey);
			}
		},
		[contentKey, ignoreWhitespace, sessionId]
	);

	return { files, requestFile };
};
