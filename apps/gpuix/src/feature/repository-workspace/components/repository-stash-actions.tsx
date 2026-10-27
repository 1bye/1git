import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, radius } from "@1git/design-tokens";
import { useEffect, useRef, useState } from "react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from "@1git/gpuix-ui/popover";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { StashWriteRequest } from "../lib/repository-stashes";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const styles = StyleSheet.create({
		panel: { padding: spacing[2], gap: spacing[1.5], flexShrink: 0 },
		selectionPanel: { minWidth: 0, flexShrink: 1 },
		row: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1.5],
		},
		label: { ...typography.sm, color: appTokens.colors.text },
		hint: { ...typography.xs, color: appTokens.colors.textMuted },
		input: {
			height: 30,
			...typography.sm,
			padding: spacing[1.5],
			borderWidth: 1,
			borderRadius: radius.md,
			borderColor: appTokens.colors.border,
			backgroundColor: appTokens.colors.field,
			color: appTokens.colors.text,
		},
	});

	return { styles };
});

type Form = { request: StashWriteRequest; title: string };

/** Anchored stash forms capture the reviewed branch/OID; dismissing a form never writes Git. */
export function RepositoryStashActions({
	state,
	placement,
	createRequest,
	onCreateRequestHandled,
	onWrite,
}: {
	state: RepositoryWorkspaceState;
	placement: "create" | "selection";
	/** Incremented by command actions to open the existing New stash form. */
	createRequest?: number;
	onCreateRequestHandled?: () => void;
	onWrite: (request: StashWriteRequest) => Promise<boolean>;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	const [form, setForm] = useState<Form | null>(null);
	const [more, setMore] = useState(false);
	const [message, setMessage] = useState("");
	const [untracked, setUntracked] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mounted = useRef(true);
	const busy = RepositoryWorkspaceModel.isBusy(state);
	const repository = state.repository;

	const disabled =
		busy ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!repository ||
		state.preview;

	const stash = RepositoryWorkspaceModel.revision(state, "stashes")?.stash;

	const identity = {
		expectedHead: repository?.head ?? null,
		expectedBranch: repository?.branchName ?? null,
	};

	useEffect(() => {
		if (!createRequest || placement !== "create" || disabled) return;

		setError(null);
		setForm({
			request: {
				kind: "create",
				expectedHead: identity.expectedHead,
				expectedBranch: identity.expectedBranch,
				message: "",
				includeUntracked: false,
			},
			title: "",
		});
		onCreateRequestHandled?.();
	}, [
		createRequest,
		disabled,
		identity.expectedBranch,
		identity.expectedHead,
		onCreateRequestHandled,
		placement,
	]);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);
	const dismiss = (): void => {
		if (busy) return;

		setForm(null);
		setError(null);
		setMore(false);
	};

	const submit = async (request: StashWriteRequest): Promise<void> => {
		if (disabled) return;

		setError(null);
		const succeeded = await onWrite(request);

		if (!mounted.current) return;

		if (succeeded) {
			setForm(null);
			setMore(false);
			setMessage("");
		} else setError("Review the result above and refresh before trying again.");
	};

	const formContent = form ? (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[1.5],
			}}
		>
			<text style={styles.label}>
				{form.request.kind === "create" ? "Stash changes" : "Delete stash?"}
			</text>
			{form.request.kind === "create" ? (
				<>
					<input
						testId="stash-message"
						aria-label="Stash message (optional)"
						placeholder="Message (optional)"
						value={message}
						readOnly={busy}
						tabIndex={0}
						style={styles.input}
						onChange={(event) => setMessage(event.value ?? "")}
					/>
					<Checkbox
						testId="stash-untracked"
						label="Include untracked files"
						tokens={appTokens}
						checked={untracked}
						disabled={busy}
						style={styles.hint}
						onCheckedChange={setUntracked}
					/>
				</>
			) : (
				<>
					<text style={styles.label}>{form.title}</text>
					<text style={styles.hint}>
						Removes this saved stash, not your working files. There is no undo
						in this app.
					</text>
				</>
			)}
			<div style={{ ...styles.row, justifyContent: "flex-end" }}>
				<Button
					testId="stash-cancel"
					autoFocus={form.request.kind === "delete"}
					tokens={appTokens}
					size="sm"
					variant="ghost"
					disabled={busy}
					onPress={dismiss}
				>
					Cancel
				</Button>
				<Button
					testId="stash-confirm"
					tokens={appTokens}
					size="sm"
					disabled={disabled}
					onPress={() => {
						const request = form.request;

						void submit(
							request.kind === "create"
								? { ...request, message, includeUntracked: untracked }
								: request
						);
					}}
				>
					{busy
						? "Working…"
						: form.request.kind === "create"
							? "Create stash"
							: "Delete stash"}
				</Button>
			</div>
			{error ? (
				<text role="alert" style={styles.hint}>
					{state.stashMutation.error ?? error}
				</text>
			) : null}
		</div>
	) : null;

	return (
		<div
			style={StyleSheet.compose(
				styles.panel,
				placement === "selection" && styles.selectionPanel
			)}
		>
			{placement === "create" ? (
				<div style={{ ...styles.row, justifyContent: "flex-end" }}>
					<Popover
						open={form !== null}
						onOpenChange={(open) => {
							if (!open) {
								dismiss();

								return;
							}

							setError(null);
							setForm({
								request: {
									kind: "create",
									...identity,
									message: "",
									includeUntracked: false,
								},
								title: "",
							});
						}}
						modal
					>
						<PopoverTrigger asChild>
							<Button
								testId="stash-create"
								tokens={appTokens}
								size="sm"
								disabled={disabled || !state.entries.changes.length}
							>
								+ New stash
							</Button>
						</PopoverTrigger>
						<PopoverContent
							tokens={appTokens}
							side="top"
							align="end"
							aria-label="New stash"
							dismissible={!busy}
						>
							{formContent}
						</PopoverContent>
					</Popover>
				</div>
			) : stash || form ? (
				<div style={styles.row}>
					<Button
						testId="stash-apply"
						tokens={appTokens}
						size="sm"
						disabled={disabled || !state.stashes.loaded || !stash}
						onPress={() => {
							if (!stash) return;

							void submit({ kind: "apply", oid: stash.oid, ...identity });
						}}
					>
						Apply
					</Button>
					<Popover
						open={more || form !== null}
						onOpenChange={(open) => {
							if (open) setMore(true);
							else dismiss();
						}}
						modal={form !== null}
					>
						<PopoverTrigger asChild>
							<Button
								testId="stash-more"
								aria-label="More stash actions"
								tokens={appTokens}
								size="sm"
								variant="ghost"
								disabled={disabled || !state.stashes.loaded || !stash}
							>
								···
							</Button>
						</PopoverTrigger>
						<PopoverContent
							tokens={appTokens}
							side="top"
							align="start"
							width={form ? 300 : 160}
							aria-label={form ? "Delete stash?" : "More stash actions"}
							dismissible={!busy}
						>
							{form ? (
								formContent
							) : (
								<Button
									testId="stash-delete"
									tokens={appTokens}
									size="sm"
									variant="ghost"
									onPress={() => {
										if (!stash) return;

										setMore(false);
										setError(null);
										setForm({
											request: { kind: "delete", oid: stash.oid, ...identity },
											title: stash.summary,
										});
									}}
								>
									Delete stash…
								</Button>
							)}
						</PopoverContent>
					</Popover>
				</div>
			) : null}
			{error && !form ? (
				<text role="alert" style={styles.hint}>
					{error}
				</text>
			) : null}
		</div>
	);
}
