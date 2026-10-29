import { radius, spacing, typography } from "@1git/design-tokens";
import type { CommitInfo } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { Text } from "@1git/gpuix-ui/text";
import { useEffect, useRef, useState } from "react";
import { useAppTheme } from "../../styles/theme";
import { RepositoryWorktrees } from "../workspace-tabs/lib/repository-worktrees";

/** Reviews one immutable commit; creation never checks out or overwrites a branch. */
export function GraphBranchForm({
	commit,
	branchNames,
	disabled,
	onCreate,
	onClose,
}: {
	commit: CommitInfo;
	branchNames: readonly string[];
	disabled: boolean;
	onCreate: (name: string, oid: string) => Promise<string | null>;
	onClose: () => void;
}) {
	const { tokens } = useAppTheme();
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const submitting = useRef(false);
	const mounted = useRef(true);

	useEffect(
		() => () => {
			mounted.current = false;
		},
		[]
	);
	const branchName = name.trim();

	const nameError =
		RepositoryWorktrees.branchNameError(branchName) ??
		(branchNames.includes(branchName)
			? "This branch already exists. Choose another name."
			: null);

	const blocked = disabled || pending || !branchName || !!nameError;

	const submit = async (): Promise<void> => {
		if (blocked || submitting.current) return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const message = await onCreate(branchName, commit.oid);

			if (!mounted.current) return;

			if (message) setError(message);
			else onClose();
		} catch {
			if (mounted.current)
				setError(
					"Could not confirm branch creation. Refresh the graph before trying again."
				);
		} finally {
			submitting.current = false;

			if (mounted.current) setPending(false);
		}
	};

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<PopoverContent
				testId="graph-branch-dialog"
				tokens={tokens}
				placement="center"
				width={400}
				dismissible={!pending}
				aria-label="Create branch here"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text tokens={tokens} size="lg">
						Create branch here
					</Text>
					<Text tokens={tokens}>{commit.summary}</Text>
					<Text tokens={tokens} size="xs" tone="muted">
						{commit.oid.slice(0, 7)}
					</Text>
					<input
						testId="graph-branch-name"
						autoFocus
						aria-label="New branch name"
						aria-invalid={!!nameError}
						placeholder="New branch name…"
						value={name}
						readOnly={pending}
						onChange={(event) => {
							setName(event.value ?? "");
							setError(null);
						}}
						onSubmit={() => void submit()}
						style={{
							...typography.md,
							height: 32,
							width: "100%",
							padding: spacing[2],
							borderRadius: radius.md,
							borderWidth: 1,
							borderColor: tokens.colors.border,
							backgroundColor: tokens.colors.field,
							color: tokens.colors.text,
						}}
					/>
					<Text tokens={tokens} size="sm" tone="muted">
						Your current branch and working files stay in place. Switch to the
						new branch when you're ready.
					</Text>
					{error || nameError ? (
						<text
							role="alert"
							style={{ ...typography.sm, color: tokens.colors.danger }}
						>
							{error ?? nameError}
						</text>
					) : null}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: spacing[2],
						}}
					>
						<Button
							testId="graph-branch-cancel"
							tokens={tokens}
							size="sm"
							variant="ghost"
							disabled={pending}
							onPress={onClose}
						>
							Cancel
						</Button>
						<Button
							testId="graph-branch-create"
							tokens={tokens}
							size="sm"
							disabled={blocked}
							onPress={() => void submit()}
						>
							{pending ? "Creating…" : "Create branch"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
