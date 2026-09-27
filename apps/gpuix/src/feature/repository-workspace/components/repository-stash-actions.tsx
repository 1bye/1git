import { useEffect, useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { appTokens } from "../../../styles/tokens";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { StashWriteRequest } from "../lib/repository-stashes";

const styles = StyleSheet.create({
	panel: { padding: 8, gap: 6, flexShrink: 0 },
	row: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6 },
	label: { fontSize: 11, color: appTokens.colors.text },
	hint: { fontSize: 10, color: appTokens.colors.textMuted },
	input: {
		height: 30,
		fontSize: 11,
		padding: 6,
		borderWidth: 1,
		borderRadius: 5,
		borderColor: appTokens.colors.border,
		backgroundColor: appTokens.colors.field,
		color: appTokens.colors.text,
	},
});

type Form = { request: StashWriteRequest; title: string };

/** Inline stash forms capture the reviewed branch/OID; dismissing a form never writes Git. */
export function RepositoryStashActions({
	state,
	placement,
	onWrite,
}: {
	state: RepositoryWorkspaceState;
	placement: "create" | "selection";
	onWrite: (request: StashWriteRequest) => Promise<boolean>;
}) {
	const renderer = useGpuixRequired();
	const [form, setForm] = useState<Form | null>(null);
	const [more, setMore] = useState(false);
	const [message, setMessage] = useState("");
	const [untracked, setUntracked] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const target = useRef<PublicInstance>(null);
	const trigger = useRef<PublicInstance>(null);
	const mounted = useRef(true);
	const restoreFocus = useRef(false);
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
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		if (form && target.current) renderer.focusElement?.(target.current.id);
		else if (!form && restoreFocus.current && trigger.current) {
			renderer.focusElement?.(trigger.current.id);
			restoreFocus.current = false;
		}
	}, [form, renderer]);

	const dismiss = (): void => {
		if (busy) return;

		setForm(null);
		setError(null);
		restoreFocus.current = true;
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
			restoreFocus.current = true;
		} else setError("Review the result above and refresh before trying again.");
	};

	return (
		<div
			style={styles.panel}
			onKeyDown={(event) => {
				if (event.key === "escape" && !busy) {
					setMore(false);
					dismiss();
				}
			}}
		>
			{form ? (
				<div style={{ gap: 6 }}>
					<text style={styles.label}>
						{form.request.kind === "create" ? "Stash changes" : "Delete stash?"}
					</text>
					{form.request.kind === "create" ? (
						<>
							<input
								ref={target}
								testId="stash-message"
								aria-label="Stash message (optional)"
								placeholder="Message (optional)"
								value={message}
								readOnly={busy}
								tabIndex={0}
								style={styles.input}
								onChange={(event) => setMessage(event.value ?? "")}
							/>
							<div style={styles.row}>
								<Checkbox
									testId="stash-untracked"
									aria-label="Include untracked files"
									tokens={appTokens}
									checked={untracked}
									disabled={busy}
									onCheckedChange={setUntracked}
								/>
								<text style={styles.hint}>Include untracked files</text>
							</div>
							<text style={styles.hint}>
								Saves all tracked changes, regardless of commit checkboxes.
								Ignored files stay untouched.
							</text>
						</>
					) : (
						<>
							<text style={styles.label}>{form.title}</text>
							<text style={styles.hint}>
								Removes this saved stash, not your working files. There is no
								undo in this app.
							</text>
						</>
					)}
					<div style={styles.row}>
						<Button
							ref={form.request.kind === "delete" ? target : undefined}
							testId="stash-cancel"
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
				</div>
			) : placement === "create" ? (
				<div style={styles.row}>
					<Button
						ref={trigger}
						testId="stash-create"
						tokens={appTokens}
						size="sm"
						variant="ghost"
						disabled={disabled || !state.entries.changes.length}
						onPress={() => {
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
					>
						{state.view === "changes" ? "Stash changes…" : "+ New stash"}
					</Button>
				</div>
			) : stash ? (
				<div style={styles.row}>
					<Button
						testId="stash-apply"
						tokens={appTokens}
						size="sm"
						disabled={disabled || !state.stashes.loaded}
						onPress={() => {
							void submit({ kind: "apply", oid: stash.oid, ...identity });
						}}
					>
						Apply
					</Button>
					<Button
						ref={trigger}
						testId="stash-more"
						aria-label="More stash actions"
						aria-expanded={more}
						tokens={appTokens}
						size="sm"
						variant="ghost"
						disabled={disabled || !state.stashes.loaded}
						onPress={() => setMore(!more)}
					>
						···
					</Button>
					{more ? (
						<Button
							testId="stash-delete"
							tokens={appTokens}
							size="sm"
							variant="ghost"
							onPress={() => {
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
					) : null}
				</div>
			) : null}
			{error ? (
				<text role="alert" style={styles.hint}>
					{error}
				</text>
			) : null}
		</div>
	);
}
