import { showActionToast } from "@1git/ui/components/action-toast";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

const DISCARD_TOAST_DURATION_MS = 10_000;
const DISCARD_TOAST_ID = "repository-discard";

interface RepositoryDiscardUndoToastProps {
	readonly detail: string;
	readonly message: string;
	readonly onDismiss: (token: string) => void;
	readonly onUndo: () => Promise<boolean>;
	readonly token: string;
}

export function RepositoryDiscardUndoToast({
	detail,
	message,
	onDismiss,
	onUndo,
	token,
}: RepositoryDiscardUndoToastProps): ReactElement | null {
	const dismissRef = useRef(onDismiss);
	const undoRef = useRef(onUndo);

	useEffect(() => {
		dismissRef.current = onDismiss;
		undoRef.current = onUndo;
	}, [onDismiss, onUndo]);

	useEffect(() => {
		showActionToast({
			action: {
				label: "Undo",
				onClick: () => {
					undoRef.current().catch(() => {
						// The workspace hook exposes the operation error in the app notice.
					});
				},
			},
			detail,
			duration: DISCARD_TOAST_DURATION_MS,
			id: DISCARD_TOAST_ID,
			message,
			onAutoClose: () => dismissRef.current(token),
			onDismiss: () => dismissRef.current(token),
		});
	}, [detail, message, token]);

	return null;
}
