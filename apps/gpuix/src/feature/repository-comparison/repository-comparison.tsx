import { createThemedStyles, useAppTheme } from "../../styles/theme";
import { spacing, typography } from "@1git/design-tokens";
import { useEffect, useState, type ReactNode } from "react";
import type { BranchComparison, CommitPage } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import { StyleSheet } from "@1git/gpuix-stylesheet";

import {
	RepositoryComparison as Reader,
	type ComparisonRequest,
} from "./lib/repository-comparison";
import { RepositoryHistory } from "../repository-workspace/lib/repository-history";
import {
	RepositoryDiff as DiffReader,
	type DiffSettings,
} from "../repository-workspace/lib/repository-diff";
import type { RepositoryPreviewCache } from "../repository-workspace/lib/repository-preview-cache";
import { RepositoryDiff } from "../repository-workspace/components/repository-diff";
import { RepositoryList } from "../repository-workspace/components/repository-list";
import { RepositoryFileLayoutToggle } from "../repository-workspace/components/repository-file-view";
import type { WorkspaceEntry } from "../repository-workspace/types";
import { ComparisonArtwork } from "../../fixture/comparison-artwork";
import { StateMessage } from "../../fixture/state-message";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const styles = StyleSheet.create({
		empty: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			minHeight: 0,
			alignItems: "center",
			justifyContent: "center",
			gap: spacing[2.5],
			padding: spacing[6],
		},
		root: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			flexBasis: 0,
			minHeight: 0,
			minWidth: 0,
			overflow: "hidden",
		},
		toolbar: {
			display: "flex",
			flexShrink: 0,
			flexDirection: "row",
			alignItems: "center",
			borderBottomWidth: 1,
			borderColor: appTokens.colors.border,
		},
		back: {
			width: 310,
			flexShrink: 0,
			padding: spacing[2],
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[1],
		},
		controls: {
			display: "flex",
			flexDirection: "row",
			flexGrow: 1,
			flexBasis: 0,
			minWidth: 0,
			padding: spacing[2],
			justifyContent: "center",
			alignItems: "center",
		},
		branchPair: {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: spacing[2],
			maxWidth: "100%",
		},
		body: {
			display: "flex",
			flexGrow: 1,
			flexBasis: 0,
			minHeight: 0,
			flexDirection: "row",
			overflow: "hidden",
		},
		sidebar: {
			display: "flex",
			flexDirection: "column",
			width: 310,
			flexShrink: 0,
			minHeight: 0,
			borderRightWidth: 1,
			borderColor: appTokens.colors.border,
		},
		commits: {
			display: "flex",
			flexDirection: "column",
			flexShrink: 0,
			overflow: "hidden",
			height: "40%",
			minHeight: 80,
			borderBottomWidth: 1,
			borderColor: appTokens.colors.border,
		},
		label: {
			padding: spacing[2.5],
			...typography.sm,
			color: appTokens.colors.textMuted,
			flexShrink: 0,
		},
		preview: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			flexBasis: 0,
			minWidth: 0,
			minHeight: 0,
			overflow: "hidden",
		},
	});

	return { styles };
});

export type ComparisonReaders = {
	fileTreeScope?: string;
	readComparison?: typeof Reader.read;
	readHistory?: typeof RepositoryHistory.read;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readDiff?: typeof DiffReader.read;
	previewCache?: RepositoryPreviewCache;
	diffSettings?: DiffSettings;
	onDiffSettingsChange?: (settings: DiffSettings) => void;
};

/** A temporary, read-only view; returning leaves the workspace's selection and draft untouched. */
export function RepositoryComparison({
	request,
	onClose,
	children,
	notice,
	backActions,
	...readers
}: {
	request: ComparisonRequest;
	onClose: () => void;
	children?: (selection: {
		base: ComparisonRequest["branches"][number];
		head: ComparisonRequest["branches"][number] | undefined;
	}) => ReactNode;
	notice?: ReactNode;
	backActions?: ReactNode;
} & ComparisonReaders) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	const [branch, setBranch] = useState(request.incoming ?? "");

	const [direction, setDirection] = useState<"incoming" | "outgoing">(
		"incoming"
	);

	const initialBase = request.branches.find(
		(item) => item.label === request.baseName && item.oid === request.base
	) ?? {
		value: request.base ? "HEAD" : "",
		label: request.baseName,
		oid: request.base,
	};

	const options =
		!initialBase.oid || request.branches.includes(initialBase)
			? request.branches
			: [initialBase, ...request.branches];

	const [base, setBase] = useState(initialBase.value);
	const selected = options.find((item) => item.value === branch);

	const selectedBase =
		options.find((item) => item.value === base) ?? initialBase;

	return (
		<div testId="branch-comparison" style={styles.root}>
			<div testId="comparison-toolbar" style={styles.toolbar}>
				<div
					style={
						request.intent === "sync"
							? { ...styles.back, width: "auto" }
							: styles.back
					}
				>
					<Button
						testId="close-comparison"
						tokens={appTokens}
						variant="secondary"
						size="sm"
						autoFocus={request.intent === "sync"}
						onPress={onClose}
					>
						Back
					</Button>
					{backActions}
				</div>
				<div style={styles.controls}>
					<div testId="comparison-branch-pair" style={styles.branchPair}>
						{request.intent === "sync" ? (
							<Text
								testId="sync-review-branches"
								tokens={appTokens}
								style={{
									...typography.sm,
									minWidth: 0,
									flexShrink: 1,
									overflow: "hidden",
									whiteSpace: "nowrap",
									textOverflow: "ellipsis",
								}}
							>
								{request.baseName} · {selected?.label}
							</Text>
						) : (
							<>
								<ComparisonBranchPicker
									side="base"
									value={base}
									options={
										request.intent === "pull-request"
											? options.filter(
													(item) => item.value !== request.incoming
												)
											: options
									}
									onChange={setBase}
								/>
								<ComparisonArtwork name="direction" />
								{request.intent === "pull-request" ? (
									<Text
										testId="pull-request-source"
										aria-label={`Source branch ${selected?.label ?? ""}`}
										tokens={appTokens}
										style={{
											...typography.sm,
											width: 160,
											minWidth: 80,
											flexShrink: 1,
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
										}}
									>
										{selected?.label}
									</Text>
								) : (
									<ComparisonBranchPicker
										side="incoming"
										value={branch}
										options={options}
										onChange={setBranch}
									/>
								)}
								{request.intent !== "pull-request" ? (
									<Button
										testId="swap-comparison"
										aria-label="Swap base and incoming branches"
										tokens={appTokens}
										variant="ghost"
										size="sm"
										disabled={!selected}
										style={{
											width: 28,
											flexShrink: 0,
											paddingLeft: spacing[0],
											paddingRight: spacing[0],
										}}
										onPress={() => {
											setBase(branch);
											setBranch(base);
										}}
									>
										<ComparisonArtwork name="swap" />
									</Button>
								) : null}
							</>
						)}
					</div>
				</div>
				{children ? (
					<div style={{ paddingRight: spacing[2], flexShrink: 0 }}>
						{children({ base: selectedBase, head: selected })}
					</div>
				) : null}
			</div>
			{notice}
			{request.intent === "sync" ? (
				<div
					role="group"
					aria-label="Changes to review"
					style={{ ...styles.toolbar, padding: spacing[2], gap: spacing[1] }}
				>
					{(["incoming", "outgoing"] as const).map((side) => (
						<Button
							key={side}
							testId={`sync-review-${side}`}
							tokens={appTokens}
							size="sm"
							variant={direction === side ? "secondary" : "ghost"}
							aria-label={`${side === "incoming" ? `Incoming changes, ${request.behind} commits` : `Outgoing changes, ${request.ahead} commits`}${direction === side ? ", selected" : ""}`}
							onPress={() => setDirection(side)}
						>
							{side === "incoming"
								? `Incoming · ${request.behind}`
								: `Outgoing · ${request.ahead}`}
						</Button>
					))}
				</div>
			) : null}
			{selected && selectedBase.oid ? (
				<ComparisonResults
					key={`${request.root}:${selectedBase.oid}:${selected.value}:${selected.oid}:${direction}`}
					request={request}
					base={direction === "incoming" ? selectedBase.oid : selected.oid}
					head={direction === "incoming" ? selected.oid : selectedBase.oid}
					direction={direction}
					{...readers}
				/>
			) : (
				<div testId="comparison-body" style={styles.body}>
					<div testId="comparison-sidebar" style={styles.sidebar}>
						<div style={styles.commits}>
							<Text tokens={appTokens} style={styles.label}>
								Incoming commits
							</Text>
							<Text tokens={appTokens} style={styles.label}>
								Choose branches to see commits.
							</Text>
						</div>
						<Text tokens={appTokens} style={styles.label}>
							Changed files
						</Text>
						<Text tokens={appTokens} style={styles.label}>
							Choose branches to see files.
						</Text>
					</div>
					<div testId="comparison-preview" style={styles.preview}>
						<div testId="comparison-empty" style={styles.empty}>
							<ComparisonArtwork name="empty" />
							<Text tokens={appTokens} style={{ ...typography.lg }}>
								Compare branches
							</Text>
							<Text
								tokens={appTokens}
								style={{ ...typography.sm, color: appTokens.colors.textMuted }}
							>
								{request.intent === "pull-request"
									? "Fetch remote branches, then choose a target branch above."
									: request.branches.length
										? "Choose an incoming branch above to see what changed."
										: "No other branches available to compare."}
							</Text>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function ComparisonBranchPicker({
	side,
	value,
	options,
	onChange,
}: {
	side: "base" | "incoming";
	value: string;
	options: ComparisonRequest["branches"];
	onChange: (value: string) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;

	return (
		<Select value={value} onValueChange={onChange} items={options}>
			<SelectTrigger
				testId={side === "base" ? "comparison-base" : "comparison-branch"}
				aria-label={side === "base" ? "Base branch" : "Incoming branch"}
				tokens={appTokens}
				style={{ width: 160, minWidth: 80, flexShrink: 1 }}
			>
				{value ? (
					<SelectValue
						tokens={appTokens}
						placeholder="Choose a branch…"
						style={{
							...typography.sm,
							minWidth: 0,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					/>
				) : (
					<Text
						tokens={appTokens}
						style={{ ...typography.sm, color: appTokens.colors.textMuted }}
					>
						Choose a branch…
					</Text>
				)}
			</SelectTrigger>
			<SelectContent tokens={appTokens}>
				{options.map((item) => (
					<SelectItem
						key={item.value}
						testId={`${side === "base" ? "base" : "compare"}-option-${item.value}`}
						value={item.value}
						tokens={appTokens}
						style={{ ...typography.sm }}
					>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function ComparisonResults({
	request,
	base,
	head,
	direction,
	readComparison = Reader.read,
	readHistory = RepositoryHistory.read,
	readCommitFiles = RepositoryHistory.readFiles,
	readDiff = DiffReader.read,
	previewCache,
	diffSettings,
	onDiffSettingsChange,
	fileTreeScope,
}: {
	request: ComparisonRequest;
	base: string;
	head: string;
	direction: "incoming" | "outgoing";
} & ComparisonReaders) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	const commitsLabel =
		direction === "incoming" ? "Incoming commits" : "Outgoing commits";

	const [comparison, setComparison] = useState<BranchComparison | null>(null);
	const [page, setPage] = useState<CommitPage | null>(null);
	const [offset, setOffset] = useState(0);
	const [loadedOffset, setLoadedOffset] = useState(-1);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [filesRetry, setFilesRetry] = useState(0);
	const [commit, setCommit] = useState<string | null>(null);
	const [files, setFiles] = useState<readonly WorkspaceEntry[]>([]);
	const [filesLoading, setFilesLoading] = useState(true);
	const [fileError, setFileError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [commitScroll, setCommitScroll] = useState(0);
	const [fileScroll, setFileScroll] = useState(0);

	useEffect(() => {
		const controller = new AbortController();

		setError(null);
		const load = async (): Promise<void> => {
			try {
				const result = await readComparison(
					request.root,
					base,
					head,
					controller.signal
				);

				if (controller.signal.aborted) return;

				if (result.ok) setComparison(result.value);
				else setError(result.error.message);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not compare branches."
					);
			}
		};

		void load();

		return () => controller.abort();
	}, [request, base, head, readComparison, retry]);

	useEffect(() => {
		if (!comparison) return;

		const controller = new AbortController();

		const load = async (): Promise<void> => {
			try {
				const result = await readHistory(
					request.root,
					`${comparison.base}..${comparison.head}`,
					offset,
					controller.signal
				);

				if (controller.signal.aborted) return;

				if (!result.ok) {
					setError(result.error.message);

					return;
				}

				setPage((previous) => ({
					...result.value,
					commits: offset
						? [...(previous?.commits ?? []), ...result.value.commits]
						: result.value.commits,
				}));
				setLoadedOffset(offset);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : "Could not read commits."
					);
			}
		};

		void load();

		return () => controller.abort();
	}, [comparison, request.root, offset, readHistory]);

	useEffect(() => {
		if (!comparison) return;

		const controller = new AbortController();

		setFilesLoading(true);
		setFileError(null);
		setFiles([]);
		setSelectedId(null);
		setFileScroll(0);
		const load = async (): Promise<void> => {
			try {
				const result = commit
					? await readCommitFiles(request.root, commit, controller.signal)
					: { ok: true as const, value: Reader.files(comparison) };

				if (controller.signal.aborted) return;

				if (result.ok) {
					setFiles(result.value);
					setSelectedId(result.value[0]?.id ?? null);
				} else setFileError(result.error.message);
			} catch (cause) {
				if (!controller.signal.aborted)
					setFileError(
						cause instanceof Error ? cause.message : "Could not read files."
					);
			} finally {
				if (!controller.signal.aborted) setFilesLoading(false);
			}
		};

		void load();

		return () => controller.abort();
	}, [comparison, request.root, commit, readCommitFiles, filesRetry]);

	const selected = files.find((item) => item.id === selectedId)?.commitFile;

	return (
		<div style={styles.root}>
			{error ? (
				<div style={styles.toolbar}>
					<Text tokens={appTokens} role="alert">
						{error}
					</Text>
					<Button
						testId="retry-comparison"
						tokens={appTokens}
						size="sm"
						onPress={() => {
							setComparison(null);
							setPage(null);
							setCommit(null);
							setFiles([]);
							setLoadedOffset(-1);
							setOffset(0);
							setRetry((value) => value + 1);
						}}
					>
						Retry
					</Button>
				</div>
			) : null}
			<div testId="comparison-body" style={styles.body}>
				<div testId="comparison-sidebar" style={styles.sidebar}>
					<div testId="comparison-commit-pane" style={styles.commits}>
						<Text tokens={appTokens} style={styles.label}>
							{commitsLabel}
							{page
								? ` · ${page.commits.length}${page.hasMore ? "+" : ""}`
								: ""}
						</Text>
						<RepositoryList
							testId="comparison-commits"
							entries={page?.commits.map(RepositoryHistory.entry) ?? []}
							label={commitsLabel}
							emptyMessage={
								page ? `No ${direction} commits` : "Loading commits…"
							}
							emptyContent={
								page && !error ? (
									<Text tokens={appTokens} style={styles.label}>
										No {direction} commits.
									</Text>
								) : (
									<StateMessage
										compact
										artwork={error ? "error" : "loading"}
										role={error ? "alert" : "status"}
										title={
											error ? "Could not read commits" : "Loading commits…"
										}
									/>
								)
							}
							state={{ selectedId: commit, scrollY: commitScroll }}
							onSelect={(id) =>
								setCommit((current) => (current === id ? null : id))
							}
							onScroll={setCommitScroll}
							onEndReached={() => {
								if (
									!error &&
									loadedOffset === offset &&
									page?.hasMore &&
									page.nextOffset !== null &&
									page.nextOffset > offset
								)
									setOffset(page.nextOffset);
							}}
						/>
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
							paddingLeft: spacing[3.5],
							paddingRight: spacing[3],
							height: 28,
							flexShrink: 0,
						}}
					>
						<Text
							tokens={appTokens}
							style={{ ...typography.xs, color: appTokens.colors.textMuted }}
						>
							{commit ? "Commit files" : "Changed files"} · {files.length}
						</Text>
						<RepositoryFileLayoutToggle testId="comparison-file-layout" />
					</div>
					<RepositoryList
						key={commit ?? "all"}
						testId="comparison-files"
						fileTree={{
							owner: JSON.stringify([base, head, commit]),
							scope: JSON.stringify([
								fileTreeScope,
								request.root,
								"comparison",
							]),
						}}
						entries={files}
						label="Comparison files"
						emptyMessage={
							fileError ?? (filesLoading ? "Loading files…" : "No file changes")
						}
						emptyContent={
							!fileError && !filesLoading && !error ? (
								<Text tokens={appTokens} style={styles.label}>
									No file changes.
								</Text>
							) : (
								<StateMessage
									compact
									artwork={error || fileError ? "error" : "loading"}
									role={error || fileError ? "alert" : "status"}
									title={
										error || fileError
											? "Could not read files"
											: "Loading files…"
									}
								/>
							)
						}
						state={{ selectedId, scrollY: fileScroll }}
						onSelect={setSelectedId}
						onPreviewIntent={(entry) => {
							const change = entry?.commitFile;

							previewCache?.intent(
								change
									? {
											root: request.root,
											change,
											version: readDiff,
											ignoreWhitespace: diffSettings?.ignoreWhitespace,
										}
									: null
							);
						}}
						onScroll={setFileScroll}
					/>
					{fileError ? (
						<Button
							tokens={appTokens}
							size="sm"
							onPress={() => setFilesRetry((value) => value + 1)}
						>
							Retry files
						</Button>
					) : null}
				</div>
				<div testId="comparison-preview" style={styles.preview}>
					{selected && !filesLoading ? (
						<RepositoryDiff
							key={`${selected.commit}:${selected.base ?? ""}`}
							root={request.root}
							change={selected}
							refreshing={false}
							statusError={null}
							readDiff={readDiff}
							cache={previewCache}
							settings={diffSettings}
							onSettingsChange={onDiffSettingsChange}
							files={files}
						/>
					) : (
						<StateMessage
							compact
							artwork={
								error || fileError
									? "error"
									: !comparison || filesLoading
										? "loading"
										: files.length
											? "file"
											: "empty"
							}
							role={error || fileError ? "alert" : "status"}
							title={
								error || fileError
									? "Comparison unavailable. Retry or choose another branch."
									: !comparison
										? "Comparing branches…"
										: filesLoading
											? "Loading files…"
											: files.length
												? "Select a file to inspect"
												: "No file changes to preview."
							}
							description={
								files.length && !error && !fileError && !filesLoading
									? "Choose a changed file from the list to see its diff."
									: undefined
							}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
