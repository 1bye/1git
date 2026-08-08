import { getFiletypeFromFileName, preloadHighlighter } from "@pierre/diffs";
import { useEffect, useMemo, useState } from "react";
import { REPOSITORY_DIFF_THEME } from "@/fixture/repository-workspace/constants/repository-diff.js";
import type { RepositoryDiffFileEntry } from "@/fixture/repository-workspace/lib/repository-diff-files.js";

export const useRepositoryDiffHighlighter = (
	entries: readonly RepositoryDiffFileEntry[]
): boolean => {
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
	const languagesKey = languages.join("\n");
	const [readyLanguagesKey, setReadyLanguagesKey] = useState<string | null>(
		null
	);

	useEffect(() => {
		if (readyLanguagesKey === languagesKey) {
			return;
		}
		let isCurrent = true;

		preloadHighlighter({
			langs: languages.length > 0 ? languages : ["text"],
			themes: [REPOSITORY_DIFF_THEME],
		})
			.then(() => {
				if (isCurrent) {
					setReadyLanguagesKey(languagesKey);
				}
			})
			.catch(() => {
				if (isCurrent) {
					setReadyLanguagesKey(languagesKey);
				}
			});

		return () => {
			isCurrent = false;
		};
	}, [languages, languagesKey, readyLanguagesKey]);

	return readyLanguagesKey === languagesKey;
};
