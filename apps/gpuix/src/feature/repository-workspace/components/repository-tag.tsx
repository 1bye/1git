import { useAppTheme } from "../../../styles/theme";
import { radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import type {
	CommitInfo,
	CreateReleaseTagInput,
	PushTagInput,
	TagInfo,
	RemoteInfo,
} from "@1git/git";
import { useEffect, useRef, useState } from "react";
import { RepositoryBranches } from "../../workspace-tabs/lib/repository-branches";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";

import { RepositoryTags } from "../lib/repository-tags";

/** Captures the commit or tag selected in History, so later selection cannot change the write. */
export interface TagReview {
	readonly root: string;
	readonly commit: CommitInfo;
	readonly tag?: TagInfo;
	readonly expectedHead: string;
	readonly expectedBranch: string | null;
}

/** Separately confirms local creation or one exact remote tag push; the window owns the pending operation. */
export function RepositoryTag({
	state,
	review,
	readBranches = RepositoryBranches.read,
	onCreate,
	onPush,
	onCancel,
	onFinished,
}: {
	state: RepositoryWorkspaceState;
	review: TagReview;
	readBranches?: typeof RepositoryBranches.read;
	onCreate?: (input: CreateReleaseTagInput) => Promise<string | null>;
	onPush?: (input: PushTagInput) => Promise<string | null>;
	onCancel: () => void;
	onFinished: () => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	const [name, setName] = useState("");
	const [message, setMessage] = useState("");
	const [remotes, setRemotes] = useState<readonly RemoteInfo[] | null>(null);
	const [selected, setSelected] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const submitting = useRef(false);
	const busy = pending || RepositoryWorkspaceModel.isBusy(state);
	const pushing = !!review.tag;
	const repository = state.repository;

	const changed =
		repository?.root !== review.root ||
		repository.head !== review.expectedHead ||
		repository.branchName !== review.expectedBranch;

	const remote = remotes?.find((item) => item.name === selected);
	const tagName = name.trim();

	const disabled =
		busy ||
		changed ||
		state.loading ||
		!!state.error ||
		state.commit.needsReview ||
		!!state.amend ||
		repository?.operation !== "normal" ||
		(pushing
			? !remote || remote.pushUrls.length !== 1 || !onPush
			: !tagName || !onCreate);

	useEffect(() => {
		if (!review.tag) return;

		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await readBranches(review.root, controller.signal);

				if (controller.signal.aborted) return;

				if (result.ok) setRemotes(result.value.remotes);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError("Could not read destinations. Cancel and try again.");
			}
		};

		void load();

		return () => controller.abort();
	}, [readBranches, review.root, review.tag]);

	const submit = async (): Promise<void> => {
		if (disabled || submitting.current) return;

		submitting.current = true;
		setPending(true);
		setError(null);

		try {
			const identity = {
				expectedHead: review.expectedHead,
				expectedBranch: review.expectedBranch,
			};

			const failure =
				review.tag && remote && onPush
					? await onPush({
							...identity,
							name: review.tag.name,
							expectedOid: review.tag.oid,
							expectedTarget: review.tag.targetOid,
							remote: remote.name,
							expectedUrl: remote.pushUrls[0] ?? "",
						})
					: onCreate
						? await onCreate({
								...identity,
								commit: review.commit.oid,
								name: tagName,
								message: message.trim() || `Release ${tagName}`,
							})
						: "Tag creation is unavailable.";

			if (failure) setError(failure);
			else onFinished();
		} catch {
			setError(
				"Could not confirm the tag action. Refresh and inspect local/remote tags before retrying."
			);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	};

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<PopoverContent
				tokens={appTokens}
				placement="center"
				width={420}
				dismissible={!busy}
				aria-label={pushing ? "Push tag" : "Create tag"}
				testId="tag-dialog"
			>
				<div
					style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
				>
					<Text tokens={appTokens} size="lg">
						{pushing ? `Push ${review.tag?.name}` : "Create tag"}
					</Text>
					<Text tokens={appTokens}>{review.commit.summary}</Text>
					<Text tokens={appTokens} size="xs" tone="muted">
						{review.commit.oid.slice(0, 7)}
					</Text>
					{pushing ? (
						<>
							<Select
								value={selected}
								onValueChange={setSelected}
								disabled={busy}
								items={(remotes ?? []).map((item) => ({
									value: item.name,
									label: item.name,
								}))}
							>
								<SelectTrigger
									tokens={appTokens}
									testId="tag-remote"
									aria-label="Remote destination"
								>
									<SelectValue
										tokens={appTokens}
										placeholder="Choose remote…"
									/>
								</SelectTrigger>
								<SelectContent tokens={appTokens}>
									{(remotes ?? []).map((item) => (
										<SelectItem
											tokens={appTokens}
											key={item.name}
											value={item.name}
											disabled={item.pushUrls.length !== 1}
											testId={`tag-remote-${item.name}`}
										>
											{item.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{remote?.pushUrls[0] ? (
								<Text
									tokens={appTokens}
									size="xs"
									tone="muted"
									testId="tag-destination"
								>
									{RepositoryTags.destinationLabel(remote.pushUrls[0])}
								</Text>
							) : null}
							<Text tokens={appTokens} size="sm" tone="muted">
								{!remotes && !error
									? "Reading destinations…"
									: remotes?.length === 0
										? "No remote configured. Add one in Repository settings."
										: "Push only this tag. Existing remote tags are never replaced."}
							</Text>
						</>
					) : (
						<>
							<input
								autoFocus
								testId="tag-name"
								aria-label="Tag name"
								placeholder="v1.0.0"
								value={name}
								readOnly={busy}
								onChange={(event) => setName(event.value ?? "")}
								style={{
									...typography.md,
									height: 30,
									borderRadius: radius.md,
									borderWidth: 1,
									borderColor: appTokens.colors.border,
									backgroundColor: appTokens.colors.field,
									paddingLeft: spacing[2],
									paddingRight: spacing[2],
								}}
							/>
							<Textarea
								tokens={appTokens}
								testId="tag-message"
								aria-label="Tag message"
								placeholder="Release message (optional)"
								value={message}
								readOnly={busy}
								onValueChange={setMessage}
								style={{ height: 70 }}
							/>
							<Text tokens={appTokens} size="sm" tone="muted">
								Create an annotated local tag. Push it separately from History.
							</Text>
						</>
					)}
					{changed || error ? (
						<Text
							tokens={appTokens}
							tone="danger"
							role="alert"
							testId="tag-error"
						>
							{changed
								? "The repository changed. Cancel and review the tag again."
								: error}
						</Text>
					) : null}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: spacing[1],
						}}
					>
						<Button
							tokens={appTokens}
							variant="secondary"
							size="sm"
							testId="tag-cancel"
							disabled={busy}
							onPress={onCancel}
						>
							Cancel
						</Button>
						<Button
							tokens={appTokens}
							size="sm"
							testId="tag-confirm"
							disabled={disabled}
							onPress={() => {
								void submit();
							}}
						>
							{pending
								? pushing
									? "Pushing…"
									: "Creating…"
								: pushing
									? "Push tag"
									: "Create tag"}
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
