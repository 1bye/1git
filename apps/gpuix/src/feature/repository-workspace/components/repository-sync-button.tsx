import { useAppTheme } from "../../../styles/theme";
import {
	controlSize,
	iconSize,
	radius,
	spacing,
	typography,
} from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";

import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";
import {
	RepositoryBranches,
	type WorkspaceBranches,
} from "../../workspace-tabs/lib/repository-branches";
import {
	RepositoryWorkspaceModel,
	type RepositoryWorkspaceState,
} from "../lib/repository-workspace-model";
import type { SyncRequest } from "../lib/repository-sync";
import { WorkspaceMenuModel } from "../../workspace-tabs/lib/workspace-menu-model";
import { NativeFileMenu } from "../lib/native-file-menu";
import {
	RepositorySyncProgress,
	syncProgressLabel,
} from "./repository-sync-progress";

const completedDurationMs = 3000;

type Panel = "status" | "publish" | null;

/** One repository-wide entry point; existing window mutations retain credentials, locking and Git safety. */
export function RepositorySyncButton({
	state,
	readBranches,
	onFetch,
	onSync,
	onCancel,
	onPublish,
	onRefresh,
	onCompare,
	onPreviewPullRequest,
	onAccounts,
	onRemotes,
	resumePublish = false,
}: {
	state: RepositoryWorkspaceState;
	readBranches: typeof RepositoryBranches.read;
	onFetch: () => Promise<void>;
	onSync: (choice: SyncRequest) => Promise<void>;
	onCancel: () => void;
	onPublish: () => void;
	onRefresh: () => void;
	onCompare: (data: WorkspaceBranches, intent?: "sync") => void;
	onPreviewPullRequest?: () => void;
	onAccounts: (accountKey?: string) => void;
	onRemotes: () => void;
	resumePublish?: boolean;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens, colors: appColors } = theme;

	const renderer = useGpuixRequired();
	const tracking = useRef(false);
	const repository = state.repository;
	const incoming = repository?.upstream ? (repository.behind ?? 0) : 0;
	const outgoing = repository?.upstream ? (repository.ahead ?? 0) : 0;
	const pending = state.sync.pending;
	const [panel, setPanel] = useState<Panel>(null);
	const [complete, setComplete] = useState(false);
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [publication, setPublication] = useState<{
		data: WorkspaceBranches;
		head: string | null;
		branch: string | null;
	} | null>(null);

	const [remote, setRemote] = useState<string | null>(null);
	const request = useRef<AbortController | null>(null);
	const starting = useRef(false);
	const mounted = useRef(true);
	const latestState = useRef(state);

	latestState.current = state;
	const previousVersion = useRef(state.sync.version);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();
		};
	}, []);
	useEffect(() => {
		const changed = previousVersion.current !== state.sync.version;

		previousVersion.current = state.sync.version;

		if (pending || state.sync.error || state.error) {
			setComplete(false);

			if (changed && (state.sync.error || state.error)) setPanel("status");

			return;
		}

		if (!changed) return;

		setComplete(true);
		const timer = setTimeout(() => setComplete(false), completedDurationMs);

		return () => clearTimeout(timer);
	}, [state.sync.version, pending, state.sync.error, state.error]);

	const publishRepository = resumePublish || repository?.remoteCount === 0;

	const action = publishRepository
		? "publish-repository"
		: !repository?.branchName || !repository.head
			? "fetch"
			: !repository.upstream
				? "publish-branch"
				: incoming && outgoing
					? "review"
					: incoming
						? "pull"
						: outgoing
							? "push"
							: "fetch";

	const busy = RepositoryWorkspaceModel.isBusy(state);

	const disabled =
		state.preview ||
		!repository ||
		state.loading ||
		reading ||
		(busy && !pending);

	const blocked =
		!repository?.head ||
		!repository.branchName ||
		repository.operation !== "normal" ||
		state.commit.needsReview ||
		!!state.error;

	const issue = error ?? state.sync.error ?? state.error;

	const accountAccess =
		panel === "status" && !pending && !error && state.sync.error
			? state.sync.accountAccess
			: undefined;

	const labels = {
		fetch: "Fetch remote updates",
		pull: "Pull incoming commits",
		push: "Push outgoing commits",
		review: "Sync — review diverged branches",
		"publish-branch": "Publish branch",
		"publish-repository": "Publish repository",
	};

	const operationLabel = pending
		? {
				fetch: "Fetching…",
				pull: "Pulling…",
				push: "Pushing…",
				sync: "Syncing…",
				publish: "Publishing…",
			}[pending]
		: null;

	const progress =
		operationLabel && state.sync.progress
			? `${operationLabel} — ${syncProgressLabel(state.sync.progress)}`
			: operationLabel;

	const label =
		progress ??
		(issue
			? "Synchronization needs attention"
			: complete
				? (state.sync.notice ?? "Fetch complete.").replace(/\.$/, "")
				: labels[action]);

	const counts = [
		incoming ? `${incoming} incoming` : "",
		outgoing ? `${outgoing} outgoing` : "",
	]
		.filter(Boolean)
		.join(", ");

	const icon =
		complete && !pending && !issue
			? "check"
			: pending || issue || action === "fetch" || action === "review"
				? "sync"
				: action === "pull"
					? "pull"
					: action === "publish-branch" || action === "publish-repository"
						? "publish"
						: "push";

	const stale =
		publication?.head !== repository?.head ||
		publication?.branch !== repository?.branchName;

	const canPublish =
		!disabled &&
		!blocked &&
		!stale &&
		!repository?.upstream &&
		!!remote &&
		publication?.data.remotes.some(
			(item) => item.name === remote && item.pushUrls.length === 1
		);

	const loadChoices = async (purpose: "publish" | "review"): Promise<void> => {
		if (!repository || request.current || reading) return;

		const controller = new AbortController();

		request.current = controller;
		setReading(true);
		setError(null);
		setPublication(null);
		setRemote(null);

		try {
			const result = await readBranches(repository.root, controller.signal);

			if (controller.signal.aborted || !mounted.current) return;

			if (!result.ok) {
				setError(result.error.message);

				if (purpose === "review") setPanel("status");

				return;
			}

			if (result.value.branches.current !== repository.branchName) {
				setError("The branch changed. Refresh before trying again.");

				if (purpose === "review") setPanel("status");

				return;
			}

			if (!result.value.remotes.length && purpose === "publish") {
				setPanel(null);
				onPublish();

				return;
			}

			if (purpose === "review") {
				onCompare(result.value, "sync");
				setPanel(null);

				return;
			}

			setPublication({
				data: result.value,
				head: repository.head,
				branch: repository.branchName,
			});
			const [onlyRemote] = result.value.remotes;

			if (
				result.value.remotes.length === 1 &&
				onlyRemote?.pushUrls.length === 1
			)
				setRemote(onlyRemote.name);
		} catch (cause) {
			if (!controller.signal.aborted) {
				setError(
					cause instanceof Error ? cause.message : "Could not read branches."
				);

				if (purpose === "review") setPanel("status");
			}
		} finally {
			if (!controller.signal.aborted) setReading(false);

			if (request.current === controller) request.current = null;
		}
	};

	const activate = async (retry = false): Promise<void> => {
		if (disabled) return;

		if (pending || (issue && !retry && !publishRepository)) {
			setPanel("status");

			return;
		}

		if (starting.current) return;

		if (action === "publish-repository") {
			onPublish();

			return;
		}

		if (action === "publish-branch") {
			setPanel("publish");
			await loadChoices("publish");

			return;
		}

		if (blocked && action !== "fetch") {
			setPanel("status");

			return;
		}

		starting.current = true;
		setError(null);
		setPanel(null);
		setComplete(false);

		try {
			// Refresh-only for divergence; never turn this click into an implicit merge or force-push.
			if (action === "fetch" || action === "review") await onFetch();
			else await onSync({ kind: "sync" });

			if (
				action === "review" &&
				mounted.current &&
				!latestState.current.sync.error &&
				!latestState.current.error
			) {
				await loadChoices("review");
			}
		} catch (cause) {
			if (mounted.current) {
				setError(
					cause instanceof Error ? cause.message : "Synchronization failed."
				);
				setPanel("status");
			}
		} finally {
			starting.current = false;
		}
	};

	const openMenu = async (event: EventPayload): Promise<void> => {
		if (tracking.current || !repository) return;

		tracking.current = true;
		const available =
			!disabled &&
			!pending &&
			!blocked &&
			!!repository.head &&
			!!repository.branchName;

		try {
			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.showItems(
				renderer,
				[
					{
						label: "Preview pull request…",
						enabled:
							available &&
							!!onPreviewPullRequest &&
							(repository.remoteCount ?? 0) > 0,
						value: "request",
					},
					{ label: "Compare branches…", enabled: available, value: "compare" },
				],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (!choice || !available) return;

			if (choice === "request") {
				close();
				onPreviewPullRequest?.();

				return;
			}

			request.current?.abort();
			const controller = new AbortController();

			request.current = controller;
			setReading(true);
			const result = await readBranches(repository.root, controller.signal);

			if (controller.signal.aborted) return;

			if (!result.ok) throw new Error(result.error.message);

			if (
				latestState.current.repository?.head !== repository.head ||
				latestState.current.repository.branchName !== repository.branchName ||
				RepositoryWorkspaceModel.isBusy(latestState.current)
			)
				throw new Error(
					"The branch changed. Refresh before opening the preview."
				);

			close();

			onCompare(result.value);
		} catch (cause) {
			if (mounted.current) {
				setError(
					cause instanceof Error
						? cause.message
						: "Could not open repository actions."
				);
				setPanel("status");
			}
		} finally {
			tracking.current = false;

			if (mounted.current) setReading(false);
		}
	};

	const fetched =
		state.sync.fetchedAt === null
			? null
			: `Fetched ${WorkspaceMenuModel.commitAge(new Date(state.sync.fetchedAt).toISOString())}`;

	const close = (): void => {
		request.current?.abort();
		request.current = null;
		setReading(false);
		setPanel(null);
		setError(null);
	};

	return (
		<div
			style={{
				width: controlSize.rail,
				height: controlSize.rail,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				flexShrink: 0,
			}}
		>
			<Tooltip open={panel ? false : undefined}>
				<TooltipTrigger asChild>
					<Button
						testId="rail-sync"
						aria-label={`${label}${counts ? ` — ${counts}` : ""}`}
						aria-description="Counts reflect the last fetch. Click to refresh and perform the safe action; publishing requires confirmation."
						tokens={appTokens}
						variant="ghost"
						focusVisible={false}
						disabled={disabled}
						onPress={() => {
							void activate();
						}}
						onContextMenu={(event) => {
							void openMenu(event);
						}}
						style={{
							position: "relative",
							width: controlSize.rail,
							height: controlSize.rail,
							padding: 0,
							borderWidth: 0,
							borderRadius: radius.lg,
							hover: { backgroundColor: appColors.editorHairline },
						}}
					>
						{pending ? (
							<RepositorySyncProgress
								progress={state.sync.progress}
								color={appColors.brand}
							/>
						) : (
							<WorkspaceTabIcon
								testId="rail-sync-icon"
								name={icon}
								size={iconSize.lg}
								color={
									issue
										? appTokens.colors.danger
										: pending
											? appColors.brand
											: appColors.editorMuted
								}
							/>
						)}
						{!pending && incoming > 0 ? (
							<text
								testId="rail-sync-incoming"
								style={{
									...typography["2xs"],
									whiteSpace: "nowrap",
									position: "absolute",
									right: -spacing[1],
									top: -spacing[1],
									paddingLeft: spacing[0.5],
									paddingRight: spacing[0.5],
									borderRadius: radius.xs,
									backgroundColor: appColors.editorSurface,
									color: appColors.editorMuted,
									pointerEvents: "none",
								}}
							>
								{`↓ ${incoming > 99 ? "99+" : incoming}`}
							</text>
						) : null}
						{!pending && outgoing > 0 ? (
							<text
								testId="rail-sync-outgoing"
								style={{
									...typography["2xs"],
									whiteSpace: "nowrap",
									position: "absolute",
									right: -spacing[1],
									bottom: -spacing[1],
									paddingLeft: spacing[0.5],
									paddingRight: spacing[0.5],
									borderRadius: radius.xs,
									backgroundColor: appColors.editorSurface,
									color: appColors.editorMuted,
									pointerEvents: "none",
								}}
							>
								{`↑ ${outgoing > 99 ? "99+" : outgoing}`}
							</text>
						) : null}
					</Button>
				</TooltipTrigger>
				<TooltipContent
					testId="rail-sync-tooltip"
					tokens={appTokens}
					side="right"
					align="center"
				>{`${label}${counts ? ` · ${counts}` : ""}`}</TooltipContent>
			</Tooltip>
			<Popover
				open={panel !== null}
				onOpenChange={(open) => {
					if (!open) close();
				}}
			>
				<PopoverContent
					placement="center"
					width={accountAccess || panel === "publish" ? 400 : 340}
					testId="rail-sync-dialog"
					aria-label={
						accountAccess
							? "Repository access needed"
							: panel === "publish"
								? "Publish branch"
								: "Synchronization status"
					}
					tokens={appTokens}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap:
								accountAccess || panel === "publish" ? spacing[3] : spacing[2],
							padding: accountAccess || panel === "publish" ? spacing[2] : 0,
						}}
					>
						<div
							style={{ display: "flex", alignItems: "center", gap: spacing[2] }}
						>
							{accountAccess ? (
								<svg
									testId="rail-sync-access-icon"
									aria-hidden
									source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>'
									style={{
										width: iconSize.md,
										height: iconSize.md,
										flexShrink: 0,
										color: appTokens.colors.danger,
									}}
								/>
							) : null}
							<text
								role="heading"
								aria-level={2}
								style={{ ...typography.lg, color: appColors.editorInk }}
							>
								{accountAccess
									? "Repository access needed"
									: panel === "publish"
										? "Publish branch"
										: (progress ?? "Synchronization")}
							</text>
						</div>
						<text
							testId="rail-sync-message"
							style={{
								...typography.sm,
								width: "100%",
								color:
									issue && !accountAccess
										? appTokens.colors.danger
										: appColors.editorMuted,
							}}
							role={issue ? "alert" : "status"}
						>
							{accountAccess?.message ??
								issue ??
								(reading
									? "Reading remotes…"
									: panel === "publish"
										? `Choose where to publish ${repository?.branchName ?? "this branch"}.`
										: blocked
											? "Refresh and review this repository. Publishing and syncing require a committed branch with no ongoing Git operation."
											: progress
												? "The operation continues if you close this dialog."
												: (state.sync.notice ??
													"Remote status is up to date."))}
						</text>
						{fetched && !accountAccess ? (
							<text style={{ ...typography.xs, color: appColors.editorMuted }}>
								{fetched}
							</text>
						) : null}
						{panel === "publish" && publication ? (
							<div
								role="group"
								aria-label="Remote destination"
								style={{
									display: "flex",
									flexDirection: "column",
									maxHeight: 180,
									overflowY: "scroll",
									gap: spacing[2],
								}}
							>
								{publication.data.remotes.map((item) => (
									<Button
										key={item.name}
										testId={`publish-remote-${item.name}`}
										aria-label={`${item.name}${remote === item.name ? ", selected" : ""}`}
										tokens={appTokens}
										variant={remote === item.name ? "secondary" : "ghost"}
										size="sm"
										disabled={busy || item.pushUrls.length !== 1}
										style={{
											height: 40,
											justifyContent: "space-between",
											paddingLeft: spacing[3],
											paddingRight: spacing[3],
											borderColor:
												remote === item.name
													? appTokens.colors.accentBorder
													: appTokens.colors.border,
										}}
										onPress={() => setRemote(item.name)}
									>
										<text
											style={{
												...typography.sm,
												color: appColors.editorInk,
												flexShrink: 1,
												minWidth: 0,
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												pointerEvents: "none",
											}}
										>
											{item.name}
										</text>
										{remote === item.name ? (
											<WorkspaceTabIcon name="check" color={appColors.brand} />
										) : null}
									</Button>
								))}
								{stale ? (
									<text role="alert" style={typography.sm}>
										The branch changed. Close and reopen this dialog before
										publishing.
									</text>
								) : null}
							</div>
						) : null}
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								gap: spacing[2],
							}}
						>
							<Button
								testId="rail-sync-close"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								onPress={close}
							>
								Close
							</Button>
							{accountAccess ? <div style={{ flexGrow: 1 }} /> : null}
							{accountAccess ? (
								<>
									<Button
										testId="rail-sync-remotes"
										tokens={appTokens}
										variant="secondary"
										size="sm"
										onPress={() => {
											close();
											onRemotes();
										}}
									>
										Remote settings…
									</Button>
									<Button
										testId="rail-sync-accounts"
										tokens={appTokens}
										size="sm"
										onPress={() => {
											close();
											onAccounts(accountAccess.accountKey);
										}}
									>
										{accountAccess.accountKey
											? "Reconnect account…"
											: "Account settings…"}
									</Button>
								</>
							) : pending ? (
								<Button
									testId="rail-sync-stop"
									tokens={appTokens}
									size="sm"
									onPress={onCancel}
								>
									Stop
								</Button>
							) : panel === "publish" ? (
								<Button
									testId="confirm-publish"
									tokens={appTokens}
									size="sm"
									disabled={!canPublish}
									onPress={() => {
										if (!canPublish || !remote || !repository?.branchName)
											return;

										close();
										void onSync({
											kind: "publish",
											remote,
											remoteRef: `refs/heads/${repository.branchName}`,
										});
									}}
								>
									{remote ? `Publish to ${remote}` : "Publish"}
								</Button>
							) : (
								<>
									{issue && !state.error && (!blocked || action === "fetch") ? (
										<Button
											testId="rail-sync-retry"
											tokens={appTokens}
											size="sm"
											disabled={disabled}
											onPress={() => {
												void activate(true);
											}}
										>
											Retry
										</Button>
									) : null}
									<Button
										testId="rail-sync-refresh"
										tokens={appTokens}
										size="sm"
										disabled={busy || state.loading}
										onPress={() => {
											close();
											onRefresh();
										}}
									>
										Refresh
									</Button>
								</>
							)}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
