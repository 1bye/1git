import { useEffect, useState } from "react";
import type { RecentRepositoryPreview } from "../../../../../shared/repository-session.js";

interface RecentRepositoryPreviewState {
	readonly path: string;
	readonly preview: RecentRepositoryPreview | null;
}

export const useRecentRepositoryPreview = (
	path: string
): RecentRepositoryPreview | null => {
	const [state, setState] = useState<RecentRepositoryPreviewState | null>(null);

	useEffect(() => {
		let isDisposed = false;
		const loadPreview = async (): Promise<void> => {
			const result = await window.desktop.git.sessions.preview({ path });
			if (!isDisposed) {
				setState({
					path,
					preview: result.ok ? result.value : null,
				});
			}
		};
		loadPreview().catch(() => {
			if (!isDisposed) {
				setState({ path, preview: null });
			}
		});

		return () => {
			isDisposed = true;
		};
	}, [path]);

	return state?.path === path ? state.preview : null;
};
