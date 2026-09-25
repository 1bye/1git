import type { AnimationEvent as ReactAnimationEvent } from "react";
import { useState } from "react";

import type { RepositorySessionId } from "../../../../../shared/repository-session.js";

interface UseWorkspaceTabCloseOptions {
	readonly isOverlay: boolean;
	readonly onClose: (sessionId: RepositorySessionId) => Promise<void>;
	readonly sessionId: RepositorySessionId;
}

interface WorkspaceTabCloseState {
	readonly finishClosing: (
		event: ReactAnimationEvent<HTMLDivElement>
	) => Promise<void>;
	readonly isClosing: boolean;
	readonly startClosing: () => void;
}

const WORKSPACE_TAB_EXIT_ANIMATION_NAME = "workspace-tab-content-melt-out";

export const useWorkspaceTabClose = ({
	isOverlay,
	onClose,
	sessionId,
}: UseWorkspaceTabCloseOptions): WorkspaceTabCloseState => {
	const [isClosing, setIsClosing] = useState(false);
	const startClosing = (): void => {
		if (isClosing || isOverlay) {
			return;
		}
		setIsClosing(true);
	};
	const finishClosing = async (
		event: ReactAnimationEvent<HTMLDivElement>
	): Promise<void> => {
		if (
			!isClosing ||
			event.target !== event.currentTarget ||
			event.animationName !== WORKSPACE_TAB_EXIT_ANIMATION_NAME
		) {
			return;
		}
		await onClose(sessionId);
		setIsClosing(false);
	};

	return {
		finishClosing,
		isClosing,
		startClosing,
	};
};
