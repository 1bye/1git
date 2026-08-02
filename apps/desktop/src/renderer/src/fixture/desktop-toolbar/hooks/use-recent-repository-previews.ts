import { useEffect, useState } from "react";
import { getRepositoryOwner } from "@/feature/workspace/lib/repository-owner.js";
import {
	type RecentRepositoryPreviewCache,
	recentRepositoryPreviewCache,
} from "@/fixture/desktop-toolbar/lib/recent-repository-preview-cache.js";
import { preloadRepositoryOwnerAvatar } from "@/fixture/desktop-toolbar/lib/repository-owner-avatar-cache.js";
import type {
	RecentRepositoryPreview,
	RecentRepositoryRecord,
} from "../../../../../shared/repository-session.js";

const cachedPreviews = (
	repositories: readonly RecentRepositoryRecord[],
	cache: RecentRepositoryPreviewCache
): ReadonlyMap<string, RecentRepositoryPreview> => {
	const previews = new Map<string, RecentRepositoryPreview>();
	for (const repository of repositories) {
		const preview = cache.peek(repository.path);
		if (preview) {
			previews.set(repository.path, preview);
		}
	}
	return previews;
};

export const useRecentRepositoryPreviews = (
	repositories: readonly RecentRepositoryRecord[],
	shouldRevalidate: boolean
): ReadonlyMap<string, RecentRepositoryPreview> => {
	const pathKey = repositories
		.map((repository) => repository.path)
		.join("\u0000");
	const [previews, setPreviews] = useState<
		ReadonlyMap<string, RecentRepositoryPreview>
	>(() => cachedPreviews(repositories, recentRepositoryPreviewCache));

	useEffect(() => {
		let isDisposed = false;
		const paths = pathKey ? pathKey.split("\u0000") : [];
		const loadPreviews = (): void => {
			if (isDisposed) {
				return;
			}
			for (const path of paths) {
				recentRepositoryPreviewCache
					.load(path)
					.then((preview) => {
						if (!(preview && !isDisposed)) {
							return;
						}
						preloadRepositoryOwnerAvatar(
							getRepositoryOwner(preview.remotes, preview.head.upstream)
						);
						setPreviews((current) => {
							if (current.get(path) === preview) {
								return current;
							}
							const next = new Map(current);
							next.set(path, preview);
							return next;
						});
					})
					.catch(() => undefined);
			}
		};
		if (shouldRevalidate) {
			loadPreviews();
		} else {
			queueMicrotask(loadPreviews);
		}
		return () => {
			isDisposed = true;
		};
	}, [pathKey, shouldRevalidate]);

	return previews;
};
