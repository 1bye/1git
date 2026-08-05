import { showActionToast } from "@1git/ui/components/action-toast";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

const HUNK_DISCARD_TOAST_DURATION_MS = 10_000;
const HUNK_DISCARD_TOAST_ID = "repository-hunk-discard";

interface RepositoryHunkUndoToastProps {
	readonly onDismiss: (token: string) => void;
	readonly onUndo: () => Promise<boolean>;
	readonly path: string;
	readonly token: string;
}

const fileNameFromPath = (path: string): string =>
	path.split("/").at(-1) ?? path;

export function RepositoryHunkUndoToast({
	onDismiss,
	onUndo,
	path,
	token,
}: RepositoryHunkUndoToastProps): ReactElement | null {
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
			detail: fileNameFromPath(path),
			duration: HUNK_DISCARD_TOAST_DURATION_MS,
			id: HUNK_DISCARD_TOAST_ID,
			message: "Hunk discarded from",
			onAutoClose: () => dismissRef.current(token),
			onDismiss: () => dismissRef.current(token),
		});
	}, [path, token]);

	return null;
}
