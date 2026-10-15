import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { useRef, useState } from "react";
import { useAppTheme } from "../../../styles/theme";
import { NativeFileMenu } from "../lib/native-file-menu";
import {
	RepositoryFileActions,
	type FileDiscardRequest,
} from "../lib/repository-file-actions";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceAction,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

/** Whole-change-list actions, independent of the search filter, row selection and commit inclusion. */
export function RepositoryChangesHeader({
	state,
	shown,
	onAction,
	onDiscard,
}: {
	state: RepositoryWorkspaceState;
	shown?: number;
	onAction: (action: RepositoryWorkspaceAction) => void;
	onDiscard?: (request: FileDiscardRequest) => Promise<string | null>;
}) {
	const { tokens, colors } = useAppTheme();
	const renderer = useGpuixRequired();
	const trigger = useRef<PublicInstance>(null);
	const pending = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const count = state.entries.changes.length;
	const busy = RepositoryWorkspaceModel.isBusy(state);
	const label = `${state.includedFileIds.length} of ${count} selected`;

	const openMenu = async (event: EventPayload): Promise<void> => {
		if (pending.current) return;

		pending.current = true;
		setError(null);

		try {
			const repository = state.repository;

			const changes = state.entries.changes.flatMap((entry) =>
				entry.change ? [entry.change] : []
			);

			const canInclude = count > 0 && !busy;

			const canDiscard =
				!!onDiscard &&
				!!repository &&
				!state.preview &&
				!busy &&
				!state.loading &&
				!state.error &&
				!state.commit.needsReview &&
				repository.operation === "normal" &&
				changes.length === count &&
				RepositoryFileActions.canDiscard(changes);

			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.showItems(
				renderer,
				[
					{
						label: "Include all files in commit",
						enabled: canInclude,
						value: "include",
					},
					{
						label: "Exclude all files from commit",
						enabled: canInclude,
						value: "exclude",
					},
					{ separator: true },
					{
						label: "Discard all changes…",
						enabled: canDiscard,
						value: "discard",
					},
				],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice === "include" || choice === "exclude") {
				onAction({ type: "include-all", included: choice === "include" });
			} else if (
				choice === "discard" &&
				canDiscard &&
				repository &&
				onDiscard
			) {
				if (
					!NativeFileMenu.confirm(
						renderer,
						`all ${changes.length} changed ${changes.length === 1 ? "file" : "files"}`
					)
				)
					return;

				setError(
					await onDiscard({
						kind: "discard",
						paths: changes.map((change) => change.path),
						expectedHead: repository.head,
						expectedBranch: repository.branchName,
					})
				);
			}
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not perform changes action. Refresh before retrying."
			);
		} finally {
			pending.current = false;
		}
	};

	return (
		<>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					height: 24,
					paddingLeft: spacing[3.5],
					paddingRight: spacing[3] - 1,
					flexShrink: 0,
				}}
			>
				<Button
					ref={trigger}
					testId="repository-heading"
					tokens={tokens}
					variant="ghost"
					size="sm"
					aria-label={label}
					aria-description="Actions for all changed files. Click, right-click or press Shift+F10."
					disabled={!count}
					textStyle={{ ...typography.xs, color: colors.editorMuted }}
					style={{
						height: 24,
						minWidth: 0,
						flexGrow: 1,
						justifyContent: "flex-start",
						borderWidth: 0,
						paddingLeft: 0,
						paddingRight: 0,
						hover: { backgroundColor: "transparent" },
					}}
					onContextMenu={(event) => {
						void openMenu(event);
					}}
					onPress={() => {
						if (trigger.current)
							void openMenu({
								eventType: "click",
								elementId: trigger.current.id,
							});
					}}
				>
					{label}
				</Button>
				{shown !== undefined ? (
					<text
						style={{ ...typography["2xs"], color: colors.editorFaint }}
					>{`${shown} shown`}</text>
				) : null}
				<Checkbox
					testId="include-all"
					aria-label="Include all changed files in commit"
					tokens={tokens}
					checked={
						state.includedFileIds.length === 0
							? false
							: state.includedFileIds.length === count &&
								  !Object.keys(state.partialFiles ?? {}).length
								? true
								: "indeterminate"
					}
					disabled={!count || busy}
					onCheckedChange={(included) =>
						onAction({ type: "include-all", included })
					}
				/>
			</div>
			{error && error !== state.operationMutation.error ? (
				<text
					testId="changes-menu-error"
					role="alert"
					style={{
						...typography.xs,
						color: tokens.colors.danger,
						padding: spacing[2],
					}}
				>
					{error}
				</text>
			) : null}
		</>
	);
}
