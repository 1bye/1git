import { getFiletypeFromFileName, preloadHighlighter } from "@pierre/diffs";
import { useEffect, useMemo } from "react";
import { REPOSITORY_DIFF_THEME } from "@/fixture/repository-workspace/constants/repository-diff.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

export const useRepositoryDiffHighlighter = (
	entries: readonly RepositoryDiffFileEntry[]
): void => {
	const languages = useMemo(
		() => [
			...new Set(
				entries
					.filter((entry) => entry.file)
					.map((entry) => getFiletypeFromFileName(entry.path))
			),
		],
		[entries]
	);

	useEffect(() => {
		preloadHighlighter({
			langs: languages.length > 0 ? languages : ["text"],
			themes: [REPOSITORY_DIFF_THEME],
		}).catch(() => undefined);
	}, [languages]);
};
