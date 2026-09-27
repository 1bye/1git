import { useEffect, useState } from "react";
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
import { appTokens } from "../../styles/tokens";
import {
	RepositoryComparison as Reader,
	type ComparisonRequest,
} from "./lib/repository-comparison";
import { RepositoryHistory } from "../repository-workspace/lib/repository-history";
import { RepositoryDiff as DiffReader } from "../repository-workspace/lib/repository-diff";
import { RepositoryDiff } from "../repository-workspace/components/repository-diff";
import { RepositoryList } from "../repository-workspace/components/repository-list";
import type { WorkspaceEntry } from "../repository-workspace/types";

const styles = StyleSheet.create({
	root: { flexGrow: 1, minHeight: 0, minWidth: 0 },
	toolbar: {
		flexShrink: 0,
		padding: 8,
		gap: 8,
		flexDirection: "row",
		alignItems: "center",
		borderBottomWidth: 1,
		borderColor: appTokens.colors.border,
	},
	body: { flexGrow: 1, minHeight: 0, flexDirection: "row" },
	sidebar: {
		width: 310,
		flexShrink: 0,
		minHeight: 0,
		borderRightWidth: 1,
		borderColor: appTokens.colors.border,
	},
	commits: {
		height: "40%",
		minHeight: 80,
		borderBottomWidth: 1,
		borderColor: appTokens.colors.border,
	},
	label: {
		padding: 10,
		fontSize: 11,
		color: appTokens.colors.textMuted,
		flexShrink: 0,
	},
	preview: { flexGrow: 1, minWidth: 0, minHeight: 0 },
});

type Readers = {
	readComparison?: typeof Reader.read;
	readHistory?: typeof RepositoryHistory.read;
	readCommitFiles?: typeof RepositoryHistory.readFiles;
	readDiff?: typeof DiffReader.read;
};

/** A temporary, read-only view; returning leaves the workspace's selection and draft untouched. */
export function RepositoryComparison({
	request,
	onClose,
	...readers
}: { request: ComparisonRequest; onClose: () => void } & Readers) {
	const [branch, setBranch] = useState("");
	const selected = request.branches.find((item) => item.value === branch);

	return (
		<div testId="branch-comparison" style={styles.root}>
			<div style={styles.toolbar}>
				<Button
					testId="close-comparison"
					tokens={appTokens}
					variant="secondary"
					size="sm"
					onPress={onClose}
				>
					Back
				</Button>
				<Text tokens={appTokens} style={{ fontSize: 11 }}>
					Into {request.baseName}
				</Text>
				<Select
					value={branch}
					onValueChange={setBranch}
					items={request.branches}
				>
					<SelectTrigger
						testId="comparison-branch"
						aria-label="Compare branch"
						tokens={appTokens}
					>
						<SelectValue
							tokens={appTokens}
							placeholder="Choose a branch…"
							style={{ fontSize: 11 }}
						/>
					</SelectTrigger>
					<SelectContent tokens={appTokens}>
						{request.branches.map((item) => (
							<SelectItem
								key={item.value}
								testId={`compare-option-${item.value}`}
								value={item.value}
								tokens={appTokens}
								style={{ fontSize: 11 }}
							>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Text
					tokens={appTokens}
					style={{ fontSize: 10, color: appTokens.colors.textMuted }}
				>
					Read-only snapshot
				</Text>
			</div>
			{selected ? (
				<ComparisonResults
					key={`${request.root}:${request.base}:${selected.value}:${selected.oid}`}
					request={request}
					head={selected.oid}
					{...readers}
				/>
			) : (
				<Text tokens={appTokens} style={styles.label}>
					{request.branches.length
						? "Choose a branch to see its incoming commits and changes since the common ancestor. Uncommitted changes are not included."
						: "No other branches available to compare."}
				</Text>
			)}
		</div>
	);
}

function ComparisonResults({
	request,
	head,
	readComparison = Reader.read,
	readHistory = RepositoryHistory.read,
	readCommitFiles = RepositoryHistory.readFiles,
	readDiff = DiffReader.read,
}: { request: ComparisonRequest; head: string } & Readers) {
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
					request.base,
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
	}, [request, head, readComparison, retry]);

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
			<div style={styles.body}>
				<div style={styles.sidebar}>
					<div style={styles.commits}>
						<Text tokens={appTokens} style={styles.label}>
							Incoming commits
							{page
								? ` · ${page.commits.length}${page.hasMore ? "+" : ""}`
								: ""}
						</Text>
						<RepositoryList
							testId="comparison-commits"
							entries={page?.commits.map(RepositoryHistory.entry) ?? []}
							label="Incoming commits"
							emptyMessage={page ? "No incoming commits" : "Loading commits…"}
							state={{ selectedId: commit, scrollY: commitScroll }}
							onSelect={setCommit}
							onScroll={setCommitScroll}
						/>
						{page?.hasMore ? (
							<Button
								testId="comparison-load-more"
								tokens={appTokens}
								size="sm"
								variant="ghost"
								disabled={loadedOffset !== offset}
								onPress={() => {
									if (page.nextOffset !== null) setOffset(page.nextOffset);
								}}
							>
								Load more
							</Button>
						) : null}
					</div>
					<Button
						testId="comparison-all-files"
						tokens={appTokens}
						size="sm"
						variant={commit ? "ghost" : "secondary"}
						onPress={() => setCommit(null)}
					>
						All branch changes
					</Button>
					<Text tokens={appTokens} style={styles.label}>
						{commit ? "Commit files" : "Changed files"} · {files.length}
					</Text>
					<RepositoryList
						key={commit ?? "all"}
						testId="comparison-files"
						entries={files}
						label="Comparison files"
						emptyMessage={
							fileError ?? (filesLoading ? "Loading files…" : "No file changes")
						}
						state={{ selectedId, scrollY: fileScroll }}
						onSelect={setSelectedId}
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
				<div style={styles.preview}>
					{selected && !filesLoading ? (
						<RepositoryDiff
							key={`${selected.commit}:${selected.base ?? ""}:${selected.path}`}
							root={request.root}
							change={selected}
							refreshing={false}
							statusError={null}
							readDiff={readDiff}
						/>
					) : (
						<Text tokens={appTokens} style={styles.label}>
							{error
								? "Comparison unavailable. Retry or choose another branch."
								: comparison
									? filesLoading
										? "Loading files…"
										: "No file changes to preview."
									: "Comparing branches…"}
						</Text>
					)}
				</div>
			</div>
		</div>
	);
}
