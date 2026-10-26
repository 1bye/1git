import { spacing, typography } from "@1git/design-tokens";
import type { CommitInfo, CommitPage } from "@1git/git";
import { Button } from "@1git/gpuix-ui/button";
import { Scrollbars } from "@1git/gpuix-ui/scrollbar";
import { TooltipProvider } from "@1git/gpuix-ui/tooltip";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTheme } from "../../styles/theme";
import { StateMessage } from "../../fixture/state-message";
import { RepositoryList } from "../repository-workspace/components/repository-list";
import { RepositoryFileLayoutToggle } from "../repository-workspace/components/repository-file-view";
import { RepositoryHistory } from "../repository-workspace/lib/repository-history";
import { RepositoryCommitDetails } from "../repository-workspace/components/repository-commit-details";
import { RepositoryDiff } from "../repository-workspace/components/repository-diff";
import {
	RepositoryDiff as DiffReader,
	type DiffSettings,
} from "../repository-workspace/lib/repository-diff";
import type { RepositoryPreviewCache } from "../repository-workspace/lib/repository-preview-cache";
import type { WorkspaceEntry } from "../repository-workspace/types";
import {
	RepositoryGraphReader,
	type GraphReferences,
} from "./repository-graph-reader";
import { CommitGraph } from "./commit-graph";
import {
	GraphCommitRow,
	graphRowHeight,
	graphLaneWidth,
	graphColumnWidths,
} from "./graph-commit-row";

const column = {
	display: "flex",
	flexDirection: "column",
	flexGrow: 1,
	flexBasis: 0,
	minWidth: 0,
	minHeight: 0,
	overflowX: "hidden",
	overflowY: "hidden",
} as const;

const row = {
	display: "flex",
	flexDirection: "row",
	minWidth: 0,
	minHeight: 0,
} as const;

type Readers = {
	fileTreeScope?: string;
	readReferences?: typeof RepositoryGraphReader.references;
	readPage?: typeof RepositoryGraphReader.page;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readDiff?: typeof DiffReader.read;
	previewCache?: RepositoryPreviewCache;
	diffSettings?: DiffSettings;
	onDiffSettingsChange?: (settings: DiffSettings) => void;
};

/** Separate rail workspace for repository topology; all branch/ref interactions are read-only. */
export function RepositoryGraph({
	root,
	head,
	version,
	disabled = false,
	readReferences = RepositoryGraphReader.references,
	...readers
}: {
	root: string;
	head: string | null;
	version: number;
	disabled?: boolean;
} & Readers) {
	const { colors, tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const search = useRef<PublicInstance>(null);
	const window = useWindowSize();
	const sidebarWidth = window.width < 850 ? 190 : 230;
	const [result, setResult] = useState<GraphReferences | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [retry, setRetry] = useState(0);
	const [query, setQuery] = useState("");
	const [reference, setReference] = useState<string | null>(null);
	const [kind, setKind] = useState("all");
	const [scrollY, setScrollY] = useState(0);

	useEffect(() => {
		if (disabled) return;

		const controller = new AbortController();

		setLoading(true);
		setError(null);
		const load = async (): Promise<void> => {
			try {
				const response = await readReferences(root, head, controller.signal);

				if (controller.signal.aborted) return;

				if (response.ok) setResult(response.value);
				else setError(response.error.message);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not read branches and tags."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		};

		void load();

		return () => controller.abort();
	}, [root, head, version, retry, disabled, readReferences]);

	const selected = result?.references.find((ref) => ref.id === reference);

	const tips = useMemo(
		() => [
			...new Set(
				selected
					? [selected.oid]
					: [
							result?.head,
							...(result?.references.map((ref) => ref.oid) ?? []),
						].filter((oid): oid is string => !!oid)
			),
		],
		[selected, result]
	);

	const normalized = query.trim().toLocaleLowerCase();

	const references =
		result?.references.filter(
			(ref) =>
				(kind === "all" || ref.kind === kind) &&
				ref.name.toLocaleLowerCase().includes(normalized)
		) ?? [];

	const entries = references.map((ref) => ({ id: ref.id, title: ref.name }));
	const byId = new Map(references.map((ref) => [ref.id, ref]));

	return (
		<TooltipProvider delayDuration={350}>
			<div
				testId="repository-graph"
				role="region"
				aria-label="Repository graph"
				style={{ ...column, width: "100%", height: "100%" }}
			>
				{error ? (
					<div
						style={{
							...row,
							padding: spacing[2],
							alignItems: "center",
							gap: spacing[2],
						}}
					>
						<text
							role="alert"
							style={{ ...typography.sm, color: colors.deletion, flexGrow: 1 }}
						>
							{error}
						</text>
						<Button
							testId="retry-graph-refs"
							tokens={tokens}
							size="sm"
							onPress={() => setRetry((value) => value + 1)}
						>
							Retry
						</Button>
					</div>
				) : null}
				<div style={{ ...row, flexGrow: 1, flexBasis: 0 }}>
					<div
						testId="graph-sidebar"
						style={{
							...column,
							flexGrow: 0,
							flexBasis: sidebarWidth,
							width: sidebarWidth,
							flexShrink: 0,
							borderRightWidth: 1,
							borderColor: colors.editorHairline,
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								flexShrink: 0,
								padding: spacing[2],
								gap: spacing[2],
							}}
						>
							<input
								ref={search}
								testId="graph-ref-search"
								aria-label="Find branch or tag"
								placeholder="Find branch or tag…"
								value={query}
								onChange={(event) => {
									setQuery(event.value ?? "");
									setScrollY(0);
								}}
								style={{
									...typography.sm,
									color: colors.editorInk,
									backgroundColor: colors.editorSunken,
									borderRadius: 5,
									padding: spacing[2],
									height: 30,
								}}
							/>
							{selected ? (
								<Button
									testId="graph-all-refs"
									tokens={tokens}
									size="sm"
									variant="ghost"
									onPress={() => {
										setReference(null);

										if (search.current)
											renderer.focusElement?.(search.current.id);
									}}
								>
									Show full graph
								</Button>
							) : null}
							<div
								role="group"
								aria-label="Reference types"
								style={{ ...row, flexWrap: "wrap", gap: spacing[0.5] }}
							>
								{[
									{ id: "all", label: "All" },
									{ id: "local", label: "Local" },
									{ id: "remote", label: "Remote" },
									{ id: "tag", label: "Tags" },
								].map((item) => (
									<Button
										key={item.id}
										testId={`graph-kind-${item.id}`}
										tokens={tokens}
										aria-pressed={kind === item.id}
										size="sm"
										variant={kind === item.id ? "secondary" : "ghost"}
										style={{ minWidth: 0, paddingLeft: 6, paddingRight: 6 }}
										onPress={() => {
											setKind(item.id);
											setScrollY(0);
										}}
									>
										{item.label}
									</Button>
								))}
							</div>
						</div>
						<RepositoryList
							key={`${kind}:${normalized}`}
							testId="graph-references"
							entries={entries}
							label="Branches and tags"
							emptyMessage={
								loading && !result
									? "Reading refs…"
									: "No matching branches or tags"
							}
							state={{ selectedId: selected?.id ?? null, scrollY }}
							onSelect={setReference}
							onScroll={setScrollY}
							renderEntry={(entry) => {
								const ref = byId.get(entry.id);

								return (
									<div
										style={{
											...row,
											flexGrow: 1,
											alignItems: "center",
											gap: spacing[1.5],
											pointerEvents: "none",
										}}
									>
										<text
											style={{
												...typography.sm,
												color: ref?.current
													? colors.success
													: colors.editorFaint,
											}}
										>
											{ref?.current
												? "✓"
												: ref?.kind === "tag"
													? "◇"
													: ref?.kind === "remote"
														? "☁"
														: "⑂"}
										</text>
										<text
											style={{
												...typography.sm,
												color: ref?.current ? colors.success : colors.editorInk,
												flexGrow: 1,
												whiteSpace: "nowrap",
												overflowX: "hidden",
												textOverflow: "ellipsis",
											}}
										>
											{entry.title}
										</text>
									</div>
								);
							}}
						/>
					</div>
					{result ? (
						<GraphResults
							key={JSON.stringify(tips)}
							root={root}
							tips={tips}
							references={result}
							disabled={disabled}
							{...readers}
						/>
					) : (
						<StateMessage
							artwork={error ? "error" : "loading"}
							title={error ? "Could not load graph" : "Loading graph…"}
						/>
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}

function GraphResults({
	root,
	tips,
	references,
	disabled,
	readPage = RepositoryGraphReader.page,
	...readers
}: {
	root: string;
	tips: readonly string[];
	references: GraphReferences;
	disabled: boolean;
} & Readers) {
	const { colors, tokens, typography: fonts } = useAppTheme();
	const window = useWindowSize();
	const columns = graphColumnWidths(window.width, fonts?.fontSize);
	const horizontal = useRef<PublicInstance>(null);
	const metadata = useRef<PublicInstance>(null);
	const [page, setPage] = useState<CommitPage | null>(null);
	const [offset, setOffset] = useState(0);
	const [retry, setRetry] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [scrollY, setScrollY] = useState(0);
	const tipsKey = JSON.stringify(tips);

	useEffect(() => {
		if (disabled) return;

		const controller = new AbortController();

		setLoading(true);
		setError(null);
		const load = async (): Promise<void> => {
			try {
				const response = await readPage(
					root,
					JSON.parse(tipsKey),
					offset,
					controller.signal
				);

				if (controller.signal.aborted) return;

				if (response.ok)
					setPage((current) => ({
						...response.value,
						commits: offset
							? [
									...(current?.commits.slice(0, offset) ?? []),
									...response.value.commits,
								]
							: response.value.commits,
					}));
				else setError(response.error.message);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not read commit graph."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		};

		void load();

		return () => controller.abort();
	}, [root, tipsKey, offset, retry, disabled, readPage]);

	const layout = useMemo(
		() => CommitGraph.layout(page?.commits ?? []),
		[page?.commits]
	);

	const byId = useMemo(
		() => new Map(layout.rows.map((item) => [item.commit.oid, item])),
		[layout]
	);

	const labels = useMemo(() => {
		const map = new Map<string, GraphReferences["references"][number][]>();

		for (const ref of references.references) {
			const list = map.get(ref.oid) ?? [];

			list.push(ref);
			map.set(ref.oid, list);
		}

		return map;
	}, [references]);

	const entries = useMemo(
		() =>
			layout.rows.map(({ commit }) => ({
				id: commit.oid,
				title: commit.summary,
				detail: `${commit.author.name} · ${commit.oid} · ${
					labels
						.get(commit.oid)
						?.map((ref) => `${ref.kind}: ${ref.name}`)
						.join(", ") ?? ""
				}`,
			})),
		[layout, labels]
	);

	const selected = byId.get(selectedId ?? "")?.commit;

	const loadMore = (): void => {
		if (!loading && !error && page?.hasMore && page.nextOffset !== null)
			setOffset(page.nextOffset);
	};

	return (
		<div style={column}>
			<div testId="graph-commit-pane" style={{ ...column }}>
				<div
					style={{
						...row,
						alignItems: "center",
						height: 34,
						flexShrink: 0,
						paddingLeft: spacing[3],
						paddingRight: spacing[3],
						borderBottomWidth: 1,
						borderColor: colors.editorHairline,
					}}
				>
					<text
						testId="graph-commit-count"
						style={{ ...typography.xs, color: colors.editorMuted, flexGrow: 1 }}
					>
						{page
							? `${page.commits.length}${page.hasMore ? "+" : ""} commits`
							: "Reading commits…"}
					</text>
					{page?.hasMore ? (
						<Button
							testId="graph-load-more"
							tokens={tokens}
							size="sm"
							variant="ghost"
							disabled={loading || disabled}
							onPress={loadMore}
						>
							{loading ? "Loading…" : "Load older commits"}
						</Button>
					) : null}
				</div>
				{error ? (
					<div
						style={{
							...row,
							alignItems: "center",
							padding: spacing[2],
							gap: spacing[2],
						}}
					>
						<text
							role="alert"
							style={{ ...typography.sm, color: colors.deletion, flexGrow: 1 }}
						>
							{error}
						</text>
						<Button
							testId="retry-graph-page"
							tokens={tokens}
							size="sm"
							onPress={() => setRetry((value) => value + 1)}
						>
							Retry
						</Button>
					</div>
				) : null}
				<div
					ref={horizontal}
					testId="graph-horizontal-viewport"
					style={{ ...column, overflowX: "scroll" }}
				>
					<div
						style={{
							...column,
							height: "100%",
							width: "100%",
							flexShrink: 0,
							minWidth:
								graphLaneWidth(layout.lanes) +
								200 +
								columns.hash +
								columns.author +
								columns.date,
						}}
					>
						<RepositoryList
							testId="graph-commits"
							entries={entries}
							label="Commit graph"
							emptyMessage={loading ? "Loading commits…" : "No commits"}
							emptyContent={
								<StateMessage
									artwork={error ? "error" : loading ? "loading" : "history"}
									title={
										error
											? "Could not read graph"
											: loading
												? "Loading commits…"
												: "No commits yet"
									}
								/>
							}
							state={{ selectedId, scrollY }}
							onSelect={setSelectedId}
							onScroll={setScrollY}
							onEndReached={loadMore}
							itemHeight={graphRowHeight}
							renderEntry={(entry) => {
								const graphRow = byId.get(entry.id);

								return graphRow ? (
									<GraphCommitRow
										row={graphRow}
										lanes={layout.lanes}
										references={labels.get(entry.id) ?? []}
										head={references.head}
										selected={selectedId === entry.id}
									/>
								) : null;
							}}
						/>
					</div>
				</div>
				<Scrollbars
					vertical={horizontal}
					horizontal={horizontal}
					tokens={tokens}
					testId="graph-table-scrollbar"
				/>
			</div>
			{selected ? (
				<div
					testId="graph-details-pane"
					style={{
						...column,
						flexGrow: 0,
						flexBasis: undefined,
						height: "48%",
						minHeight: 180,
						borderTopWidth: 1,
						borderColor: colors.editorHairline,
					}}
				>
					<div style={{ ...row, alignItems: "center", flexShrink: 0 }}>
						<div
							ref={metadata}
							style={{
								...column,
								flexBasis: undefined,
								flexGrow: 1,
								maxHeight: window.height < 560 ? 80 : 120,
								overflowY: "scroll",
							}}
						>
							<RepositoryCommitDetails
								key={selected.oid}
								commit={selected}
								tags={references.tags}
							/>
						</div>
						<Scrollbars
							vertical={metadata}
							tokens={tokens}
							testId="graph-metadata-scrollbar"
						/>
						<Button
							testId="graph-close-details"
							aria-label="Close commit details"
							tokens={tokens}
							size="sm"
							variant="ghost"
							style={{ marginRight: spacing[2] }}
							onPress={() => setSelectedId(null)}
						>
							×
						</Button>
					</div>
					<GraphCommitFiles
						key={selected.oid}
						root={root}
						commit={selected}
						{...readers}
					/>
				</div>
			) : null}
		</div>
	);
}

function GraphCommitFiles({
	root,
	commit,
	readCommitFiles = RepositoryHistory.readFiles,
	readDiff = DiffReader.read,
	previewCache,
	diffSettings,
	onDiffSettingsChange,
	fileTreeScope,
}: { root: string; commit: CommitInfo } & Readers) {
	const { colors, tokens } = useAppTheme();
	const window = useWindowSize();
	const fileListWidth = window.width < 850 ? 150 : 220;
	const [files, setFiles] = useState<readonly WorkspaceEntry[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [scrollY, setScrollY] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);

	useEffect(() => {
		const controller = new AbortController();

		setLoading(true);
		setError(null);
		const load = async (): Promise<void> => {
			try {
				const response = await readCommitFiles(
					root,
					commit.oid,
					controller.signal
				);

				if (controller.signal.aborted) return;

				if (response.ok) {
					setFiles(response.value);
					setSelectedId(response.value[0]?.id ?? null);
				} else setError(response.error.message);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Could not read commit files."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		};

		void load();

		return () => controller.abort();
	}, [root, commit.oid, retry, readCommitFiles]);

	const selected = files.find((file) => file.id === selectedId)?.commitFile;

	return (
		<div style={{ ...row, flexGrow: 1, flexBasis: 0 }}>
			<div
				style={{
					...column,
					flexGrow: 0,
					flexBasis: fileListWidth,
					width: fileListWidth,
					flexShrink: 0,
					borderRightWidth: 1,
					borderColor: colors.editorHairline,
				}}
			>
				<div
					style={{
						...row,
						alignItems: "center",
						flexWrap: "wrap",
						justifyContent: "space-between",
						padding: spacing[2],
						flexShrink: 0,
					}}
				>
					<text
						style={{ ...typography.xs, color: colors.editorMuted }}
					>{`Changed files · ${files.length}`}</text>
					<RepositoryFileLayoutToggle testId="graph-file-layout" />
				</div>
				<RepositoryList
					testId="graph-files"
					fileTree={{
						scope: JSON.stringify([fileTreeScope, root, "graph"]),
						owner: commit.oid,
					}}
					label="Commit files"
					entries={files}
					emptyMessage={
						error ?? (loading ? "Loading files…" : "No file changes")
					}
					state={{ selectedId, scrollY }}
					onSelect={setSelectedId}
					onScroll={setScrollY}
				/>
				{error ? (
					<Button
						testId="retry-graph-files"
						tokens={tokens}
						size="sm"
						onPress={() => setRetry((value) => value + 1)}
					>
						Retry files
					</Button>
				) : null}
			</div>
			<div style={column}>
				{selected && !loading && !error ? (
					<RepositoryDiff
						key={selected.path}
						root={root}
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
						artwork={error ? "error" : loading ? "loading" : "empty"}
						role={error ? "alert" : "status"}
						title={
							error ??
							(loading
								? "Loading files…"
								: "No file changes compared with the first parent.")
						}
					/>
				)}
			</div>
		</div>
	);
}
