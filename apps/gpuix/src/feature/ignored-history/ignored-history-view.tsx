import { useEffect, useMemo, useState } from "react";
import { Button } from "@1git/gpuix-ui/button";
import { DiffView } from "@1git/gpuix-ui/diff-view";
import { spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import { repositoryDiffTheme } from "../repository-workspace/lib/repository-diff-theme";
import { RepositoryList } from "../repository-workspace/components/repository-list";
import { RepositoryDiffSettings } from "../repository-workspace/components/repository-diff-settings";
import type { DiffSettings } from "../repository-workspace/lib/repository-diff";
import type { WorkspaceEntry } from "../repository-workspace/types";
import { IgnoredHistory, type IgnoredRepository } from "./ignored-history";
import type { IgnoredHistoryStatus } from "./use-ignored-histories";

/** Familiar file list and diff, backed solely by encrypted local snapshots and explicit restore. */
export function IgnoredHistoryView({
	repository,
	history,
	status,
	onRefresh,
	onSettings,
	settings,
	onSettingsChange,
	disabled,
}: {
	repository: IgnoredRepository;
	history: IgnoredHistory;
	status?: IgnoredHistoryStatus;
	onRefresh: () => Promise<void>;
	onSettings: () => void;
	settings: DiffSettings;
	onSettingsChange: (settings: DiffSettings) => void;
	disabled?: boolean;
}) {
	const { root: repositoryRoot, commonDirectory, gitDirectory } = repository;

	const identity = useMemo(
		() => ({ root: repositoryRoot, commonDirectory, gitDirectory }),
		[repositoryRoot, commonDirectory, gitDirectory]
	);

	const theme = useAppTheme();
	const { tokens, colors } = theme;
	const [selected, setSelected] = useState<string | null>(null);
	const [scrollY, setScrollY] = useState(0);
	const [showAll, setShowAll] = useState(false);
	const [version, setVersion] = useState<string | null | undefined>();

	const [preview, setPreview] = useState<{
		patch: string;
		message: string | null;
	}>({ patch: "", message: "Select a file to review its local changes." });

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [confirm, setConfirm] = useState(false);
	const files = status?.data?.files;

	const entries = useMemo<WorkspaceEntry[]>(
		() =>
			(files ?? [])
				.filter((file) => showAll || file.changed)
				.map((file) => ({
					id: file.path,
					title: file.path,
					status: file.versions[0]?.deleted
						? "D"
						: file.baseline === null
							? "A"
							: "M",
					detail: file.changed
						? "Changed since accepted version"
						: "No pending changes",
				})),
		[files, showAll]
	);

	const selectedPath = entries.some((entry) => entry.id === selected)
		? selected
		: (entries[0]?.id ?? null);

	const file = files?.find((item) => item.path === selectedPath);
	const current = file?.versions[0];
	const latestId = current?.id;
	const baseline = version === undefined ? (file?.baseline ?? null) : version;

	useEffect(() => {
		setVersion(undefined);
		setConfirm(false);
	}, [selectedPath]);
	useEffect(() => {
		const controller = new AbortController();

		setConfirm(false);

		if (!selectedPath || !latestId) {
			setPreview({
				patch: "",
				message:
					"No pending ignored-file changes. Use All files to inspect saved versions.",
			});

			return;
		}

		setPreview({ patch: "", message: "Reading encrypted local versions…" });
		void (async () => {
			try {
				const result = await history.diff(
					identity,
					selectedPath,
					baseline,
					latestId,
					controller.signal,
					settings.ignoreWhitespace
				);

				if (!controller.signal.aborted) setPreview(result);
			} catch (cause) {
				if (!controller.signal.aborted)
					setPreview({
						patch: "",
						message:
							cause instanceof Error
								? cause.message
								: "Could not read local history.",
					});
			}
		})();

		return () => controller.abort();
	}, [
		history,
		identity,
		selectedPath,
		latestId,
		baseline,
		settings.ignoreWhitespace,
	]);

	const perform = async (action: () => Promise<unknown>) => {
		if (busy || disabled) return;

		setBusy(true);
		setError(undefined);

		try {
			await action();
			await onRefresh();
			setVersion(undefined);
			setConfirm(false);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Local history action failed."
			);
		} finally {
			setBusy(false);
		}
	};

	const muted = { ...typography.sm, color: colors.editorMuted };

	return (
		<div
			testId="ignored-history-view"
			style={{
				display: "flex",
				flexDirection: "row",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: 280,
					minHeight: 0,
					flexShrink: 0,
					borderRightWidth: 1,
					borderColor: colors.editorHairline,
					padding: spacing[2],
					gap: spacing[2],
				}}
			>
				<text
					role="heading"
					aria-level={1}
					style={{ ...typography.lg, color: colors.editorInk }}
				>
					Ignored changes
				</text>
				<text style={muted}>Local history · excluded from commits</text>
				<div style={{ display: "flex", flexDirection: "row", gap: spacing[1] }}>
					<Button
						tokens={tokens}
						size="sm"
						variant="ghost"
						testId="ignored-history-filter"
						onPress={() => setShowAll((value) => !value)}
					>
						{showAll ? "Show changes" : "All files"}
					</Button>
					<Button
						tokens={tokens}
						size="sm"
						variant="ghost"
						disabled={busy}
						onPress={() => {
							void perform(onRefresh);
						}}
					>
						Refresh
					</Button>
					<Button
						tokens={tokens}
						size="sm"
						variant="ghost"
						onPress={onSettings}
					>
						Settings
					</Button>
				</div>
				<RepositoryList
					entries={entries}
					label="Ignored files"
					testId="ignored-files"
					emptyMessage={
						status?.error
							? "Capture paused. Existing versions are retained."
							: "No ignored-file changes"
					}
					state={{ selectedId: selectedPath, scrollY }}
					onSelect={(id) => {
						setSelected(id);
						setVersion(undefined);
					}}
					onScroll={setScrollY}
				/>
				{status?.data ? (
					<text
						style={muted}
					>{`${status.data.files.length} protected · ${(status.data.bytes / 1024 ** 2).toFixed(1)} MiB stored`}</text>
				) : null}
				{status?.data?.skipped.length ? (
					<text
						role="status"
						style={muted}
					>{`${status.data.skipped.length} paths skipped (links or no longer ignored).`}</text>
				) : null}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					minHeight: 0,
					minWidth: 0,
				}}
			>
				{file && current ? (
					<>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: spacing[2],
								padding: spacing[3],
								flexShrink: 0,
							}}
						>
							<text
								style={{
									...typography.md,
									color: colors.editorInk,
									flexGrow: 1,
								}}
							>
								{file.path}
							</text>
							<Button
								testId="ignored-history-accept"
								tokens={tokens}
								size="sm"
								variant="secondary"
								disabled={busy || disabled || !file.changed}
								onPress={() => {
									void perform(() =>
										history.accept(repository, file.path, current.id)
									);
								}}
							>
								Accept current
							</Button>
							<Button
								testId="ignored-history-restore"
								tokens={tokens}
								size="sm"
								variant="secondary"
								disabled={busy || disabled || baseline === current.id}
								onPress={() => setConfirm(true)}
							>
								Restore version…
							</Button>
						</div>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								gap: spacing[1],
								flexShrink: 0,
								paddingLeft: spacing[3],
								paddingRight: spacing[3],
								overflowX: "scroll",
							}}
						>
							<Button
								testId="ignored-history-baseline"
								tokens={tokens}
								size="sm"
								variant={version === undefined ? "secondary" : "ghost"}
								onPress={() => setVersion(undefined)}
							>
								Accepted baseline
							</Button>
							{file.versions.map((saved) => (
								<Button
									key={saved.id}
									testId={`ignored-version-${saved.id}`}
									tokens={tokens}
									size="sm"
									variant={version === saved.id ? "secondary" : "ghost"}
									onPress={() => setVersion(saved.id)}
								>{`${new Date(saved.at).toLocaleString()}${saved.deleted ? " · deleted" : ""}`}</Button>
							))}
						</div>
						<RepositoryDiffSettings
							settings={settings}
							onChange={onSettingsChange}
						/>
						{confirm ? (
							<div
								testId="ignored-history-confirmation"
								role="group"
								aria-label="Restore saved version"
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									padding: spacing[3],
									gap: spacing[2],
								}}
							>
								<text style={muted}>
									Replace this file with the reviewed version? Its current
									version stays in local history.
								</text>
								<Button
									testId="ignored-history-restore-cancel"
									tokens={tokens}
									size="sm"
									variant="ghost"
									onPress={() => setConfirm(false)}
								>
									Cancel
								</Button>
								<Button
									testId="ignored-history-restore-confirm"
									tokens={tokens}
									size="sm"
									disabled={busy || disabled}
									onPress={() => {
										void perform(() =>
											history.restore(
												repository,
												file.path,
												baseline,
												current.id
											)
										);
									}}
								>
									Restore
								</Button>
							</div>
						) : null}
					</>
				) : null}
				{error || status?.error ? (
					<text
						role="alert"
						style={{
							...typography.sm,
							color: tokens.colors.danger,
							padding: spacing[3],
						}}
					>
						{error ?? status?.error}
					</text>
				) : null}
				{preview.message ? (
					<text role="status" style={{ ...muted, padding: spacing[4] }}>
						{preview.message}
					</text>
				) : (
					<DiffView
						testId="ignored-history-diff"
						patch={preview.patch}
						mode={settings.mode}
						splitLayout={settings.splitLayout}
						theme={repositoryDiffTheme.get(theme)}
						tokens={tokens}
						showFileHeader={false}
						aria-label="Ignored file local diff"
					/>
				)}
			</div>
		</div>
	);
}
