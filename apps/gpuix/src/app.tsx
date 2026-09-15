import { basename } from "node:path";
import type {
	FileChange,
	FileStatus,
	GitRepository,
	GitResult,
} from "@1git/git";
import type { EventPayload, StyleDesc } from "@gpuix/react";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import {
	loadRepositoryView,
	type RepositoryView,
	statusLabel,
	unwrapGitResult,
} from "./model";

const COLORS = {
	background: "#f4f4f2",
	border: "#dfdfdc",
	brand: "#406bde",
	brandHover: "#365fc9",
	danger: "#b83c44",
	diffAdd: "#e9f6ec",
	diffDelete: "#fbecee",
	faint: "#858581",
	ink: "#171717",
	muted: "#5f5f5b",
	selected: "#e8edfa",
	surface: "#ffffff",
	transparent: "#00000000",
} as const;

const DIFF_THEME = {
	accent: COLORS.brand,
	appearance: "light",
	bg: COLORS.surface,
	border: "#ececea",
	caret: COLORS.brand,
	diffAdd: COLORS.diffAdd,
	diffDel: COLORS.diffDelete,
	diffHunkBg: "#f2f5fb",
	fontMono: "Menlo",
	fontSans: ".SystemUIFont",
	metrics: {
		diffFileHeaderHeight: 36,
		diffHunkHeaderHeight: 30,
		diffLineHeight: 21,
		diffTextSize: 12,
	},
	text: COLORS.ink,
	textFaint: COLORS.faint,
	textMuted: COLORS.muted,
} as const;

const INPUT_THEME = {
	accent: COLORS.brand,
	appearance: "light",
	bg: COLORS.surface,
	border: COLORS.border,
	caret: COLORS.brand,
	fontSans: ".SystemUIFont",
	text: COLORS.ink,
	textFaint: COLORS.faint,
	textMuted: COLORS.muted,
} as const;

const ROOT_STYLE: StyleDesc = {
	backgroundColor: COLORS.background,
	color: COLORS.ink,
	display: "flex",
	flexDirection: "column",
	fontFamily: ".SystemUIFont",
	height: "100%",
	minHeight: 0,
	minWidth: 0,
	width: "100%",
};

interface ActionProps {
	readonly disabled?: boolean;
	readonly label: string;
	readonly onPress: () => void;
	readonly primary?: boolean;
	readonly testId?: string;
}

const Action = ({
	disabled = false,
	label,
	onPress,
	primary = false,
	testId,
}: ActionProps): ReactNode => {
	const activate = (): void => {
		if (!disabled) {
			onPress();
		}
	};
	const handleKeyDown = (event: EventPayload): void => {
		if (event.key === "enter" || event.key === "space") {
			activate();
		}
	};
	const backgroundColor = primary ? COLORS.brand : COLORS.surface;
	const hoverColor = primary ? COLORS.brandHover : "#f4f4f2";

	return (
		<div
			onClick={activate}
			onKeyDown={handleKeyDown}
			style={{
				active: disabled ? {} : { opacity: 0.82 },
				alignItems: "center",
				backgroundColor,
				borderColor: primary ? COLORS.brand : COLORS.border,
				borderRadius: 8,
				borderWidth: 1,
				color: primary ? COLORS.surface : COLORS.ink,
				cursor: disabled ? "default" : "pointer",
				display: "flex",
				height: 30,
				hover: disabled ? {} : { backgroundColor: hoverColor },
				justifyContent: "center",
				opacity: disabled ? 0.45 : 1,
				paddingLeft: 10,
				paddingRight: 10,
				userSelect: "none",
			}}
			tabIndex={disabled ? undefined : 0}
			testId={testId}
		>
			<text style={{ fontSize: 12, fontWeight: 600 }}>{label}</text>
		</div>
	);
};

interface TitlebarProps {
	readonly branch: string;
	readonly busy: boolean;
	readonly changeCount: number;
	readonly onRefresh: () => void;
	readonly repositoryName: string;
	readonly repositoryPath: string;
}

const Titlebar = ({
	branch,
	busy,
	changeCount,
	onRefresh,
	repositoryName,
	repositoryPath,
}: TitlebarProps): ReactNode => (
	<div
		style={{
			alignItems: "center",
			display: "flex",
			flexDirection: "row",
			flexShrink: 0,
			gap: 10,
			height: 46,
			paddingLeft: 76,
			paddingRight: 10,
			userSelect: "none",
		}}
	>
		<div
			style={{
				alignItems: "center",
				backgroundColor: COLORS.surface,
				borderColor: COLORS.border,
				borderRadius: 9,
				borderWidth: 1,
				display: "flex",
				flexDirection: "row",
				gap: 9,
				height: 34,
				paddingLeft: 11,
				paddingRight: 11,
			}}
		>
			<div
				style={{
					backgroundColor: COLORS.brand,
					borderRadius: 4,
					height: 16,
					width: 16,
				}}
			/>
			<text style={{ fontSize: 13, fontWeight: 650 }}>{repositoryName}</text>
			<text style={{ color: COLORS.faint, fontSize: 11 }}>{branch}</text>
			<div
				style={{
					alignItems: "center",
					backgroundColor: "#eeeeeb",
					borderRadius: 8,
					display: "flex",
					height: 18,
					justifyContent: "center",
					minWidth: 18,
					paddingLeft: 5,
					paddingRight: 5,
				}}
			>
				<text style={{ color: COLORS.muted, fontSize: 10 }}>
					{String(changeCount)}
				</text>
			</div>
		</div>
		<text
			style={{
				color: COLORS.faint,
				flexGrow: 1,
				fontSize: 11,
				minWidth: 0,
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			}}
		>
			{repositoryPath}
		</text>
		<Action
			disabled={busy}
			label={busy ? "Refreshing…" : "Refresh"}
			onPress={onRefresh}
			testId="refresh"
		/>
	</div>
);

interface FileRowProps {
	readonly busy: boolean;
	readonly file: FileChange;
	readonly onAction: () => void;
	readonly onSelect: () => void;
	readonly selected: boolean;
	readonly status: FileStatus;
	readonly verb: "Stage" | "Unstage";
}

const FileRow = ({
	busy,
	file,
	onAction,
	onSelect,
	selected,
	status,
	verb,
}: FileRowProps): ReactNode => {
	const handleSelectKey = (event: EventPayload): void => {
		if (event.key === "enter" || event.key === "space") {
			onSelect();
		}
	};
	const displayPath = file.originalPath
		? `${file.originalPath} → ${file.path}`
		: file.path;

	return (
		<div
			style={{
				alignItems: "center",
				backgroundColor: selected ? COLORS.selected : COLORS.transparent,
				borderRadius: 8,
				display: "flex",
				flexDirection: "row",
				gap: 8,
				height: 34,
				hover: selected ? {} : { backgroundColor: "#ececea" },
				marginLeft: 7,
				marginRight: 7,
				paddingLeft: 8,
				paddingRight: 6,
			}}
		>
			<div
				onClick={onSelect}
				onKeyDown={handleSelectKey}
				style={{
					alignItems: "center",
					cursor: "pointer",
					display: "flex",
					flexDirection: "row",
					flexGrow: 1,
					gap: 8,
					minWidth: 0,
				}}
				tabIndex={0}
				testId={`select-${verb.toLowerCase()}-${file.path}`}
			>
				<div
					style={{
						alignItems: "center",
						backgroundColor: status === "deleted" ? "#f8e2e4" : "#e5ebfa",
						borderRadius: 5,
						display: "flex",
						height: 22,
						justifyContent: "center",
						width: 22,
					}}
				>
					<text
						style={{
							color: status === "deleted" ? COLORS.danger : COLORS.brand,
							fontFamily: "Menlo",
							fontSize: 10,
							fontWeight: 700,
						}}
					>
						{statusLabel(status)}
					</text>
				</div>
				<text
					style={{
						flexGrow: 1,
						fontSize: 12,
						minWidth: 0,
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{displayPath}
				</text>
			</div>
			<Action disabled={busy} label={verb} onPress={onAction} />
		</div>
	);
};

interface FileGroupProps {
	readonly actionLabel: "Stage all" | "Unstage all";
	readonly busy: boolean;
	readonly files: readonly FileChange[];
	readonly label: string;
	readonly onActionAll: () => void;
	readonly onFileAction: (path: string) => void;
	readonly onSelect: (path: string) => void;
	readonly selectedPath: string | null;
	readonly statusOf: (file: FileChange) => FileStatus;
	readonly verb: "Stage" | "Unstage";
}

const FileGroup = ({
	actionLabel,
	busy,
	files,
	label,
	onActionAll,
	onFileAction,
	onSelect,
	selectedPath,
	statusOf,
	verb,
}: FileGroupProps): ReactNode => {
	if (files.length === 0) {
		return null;
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", paddingBottom: 5 }}>
			<div
				style={{
					alignItems: "center",
					display: "flex",
					flexDirection: "row",
					height: 34,
					paddingLeft: 15,
					paddingRight: 9,
				}}
			>
				<text
					style={{
						color: COLORS.muted,
						flexGrow: 1,
						fontSize: 11,
						fontWeight: 650,
					}}
				>
					{`${label} · ${files.length}`}
				</text>
				<Action disabled={busy} label={actionLabel} onPress={onActionAll} />
			</div>
			{files.map((file) => (
				<FileRow
					busy={busy}
					file={file}
					key={`${verb}-${file.path}`}
					onAction={() => onFileAction(file.path)}
					onSelect={() => onSelect(file.path)}
					selected={file.path === selectedPath}
					status={statusOf(file)}
					verb={verb}
				/>
			))}
		</div>
	);
};

interface CommitDockProps {
	readonly busy: boolean;
	readonly description: string;
	readonly onCommit: () => void;
	readonly onDescriptionChange: (value: string) => void;
	readonly onSummaryChange: (value: string) => void;
	readonly stagedCount: number;
	readonly summary: string;
}

const CommitDock = ({
	busy,
	description,
	onCommit,
	onDescriptionChange,
	onSummaryChange,
	stagedCount,
	summary,
}: CommitDockProps): ReactNode => {
	const canCommit = !busy && stagedCount > 0 && summary.trim().length > 0;

	return (
		<div
			style={{
				borderColor: COLORS.border,
				borderWidth: 1,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: 10,
			}}
		>
			<input
				onChange={(event) => onSummaryChange(event.value ?? "")}
				onSubmit={onCommit}
				placeholder="Commit summary"
				style={{
					backgroundColor: COLORS.surface,
					borderColor: COLORS.border,
					borderRadius: 8,
					borderWidth: 1,
					fontSize: 12,
					height: 34,
					paddingLeft: 10,
					paddingRight: 10,
				}}
				tabIndex={0}
				testId="commit-summary"
				theme={INPUT_THEME}
				value={summary}
			/>
			<textarea
				maxRows={4}
				minRows={2}
				onChange={(event) => onDescriptionChange(event.value ?? "")}
				placeholder="Description (optional)"
				style={{
					backgroundColor: COLORS.surface,
					borderColor: COLORS.border,
					borderRadius: 8,
					borderWidth: 1,
					fontSize: 12,
					height: 58,
					padding: 9,
				}}
				tabIndex={0}
				testId="commit-description"
				theme={INPUT_THEME}
				value={description}
			/>
			<Action
				disabled={!canCommit}
				label={
					stagedCount === 1 ? "Commit 1 file" : `Commit ${stagedCount} files`
				}
				onPress={onCommit}
				primary
				testId="commit"
			/>
		</div>
	);
};

interface RailProps {
	readonly busy: boolean;
	readonly description: string;
	readonly onCommit: () => void;
	readonly onDescriptionChange: (value: string) => void;
	readonly onSelect: (path: string) => void;
	readonly onStageAll: () => void;
	readonly onStageFile: (path: string) => void;
	readonly onSummaryChange: (value: string) => void;
	readonly onUnstageAll: () => void;
	readonly onUnstageFile: (path: string) => void;
	readonly summary: string;
	readonly view: RepositoryView;
}

const Rail = ({
	busy,
	description,
	onCommit,
	onDescriptionChange,
	onSelect,
	onStageAll,
	onStageFile,
	onSummaryChange,
	onUnstageAll,
	onUnstageFile,
	summary,
	view,
}: RailProps): ReactNode => (
	<div
		style={{
			display: "flex",
			flexDirection: "column",
			flexShrink: 0,
			height: "100%",
			minHeight: 0,
			width: 310,
		}}
	>
		<div
			style={{
				alignItems: "center",
				display: "flex",
				flexDirection: "row",
				flexShrink: 0,
				height: 48,
				paddingLeft: 15,
				paddingRight: 12,
			}}
		>
			<text style={{ flexGrow: 1, fontSize: 14, fontWeight: 700 }}>
				Changes
			</text>
			<text style={{ color: COLORS.faint, fontSize: 11 }}>
				{`${view.snapshot.files.length} files`}
			</text>
		</div>
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflowY: "scroll",
			}}
		>
			{view.snapshot.files.length === 0 ? (
				<div
					style={{
						alignItems: "center",
						display: "flex",
						flexDirection: "column",
						gap: 7,
						padding: 24,
					}}
				>
					<text style={{ fontSize: 13, fontWeight: 650 }}>
						Working tree clean
					</text>
					<text style={{ color: COLORS.faint, fontSize: 11 }}>
						Nothing to stage or commit.
					</text>
				</div>
			) : (
				<>
					<FileGroup
						actionLabel="Unstage all"
						busy={busy}
						files={view.stagedFiles}
						label="Staged"
						onActionAll={onUnstageAll}
						onFileAction={onUnstageFile}
						onSelect={onSelect}
						selectedPath={view.selectedPath}
						statusOf={(file) => file.indexStatus}
						verb="Unstage"
					/>
					<FileGroup
						actionLabel="Stage all"
						busy={busy}
						files={view.unstagedFiles}
						label="Unstaged"
						onActionAll={onStageAll}
						onFileAction={onStageFile}
						onSelect={onSelect}
						selectedPath={view.selectedPath}
						statusOf={(file) => file.worktreeStatus}
						verb="Stage"
					/>
				</>
			)}
		</div>
		<CommitDock
			busy={busy}
			description={description}
			onCommit={onCommit}
			onDescriptionChange={onDescriptionChange}
			onSummaryChange={onSummaryChange}
			stagedCount={view.stagedFiles.length}
			summary={summary}
		/>
	</div>
);

interface DiffCanvasProps {
	readonly view: RepositoryView;
}

const DiffCanvas = ({ view }: DiffCanvasProps): ReactNode => (
	<div
		style={{
			backgroundColor: COLORS.surface,
			borderColor: COLORS.border,
			borderRadius: 14,
			borderWidth: 1,
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			marginBottom: 6,
			marginRight: 6,
			minHeight: 0,
			minWidth: 0,
			overflow: "hidden",
		}}
	>
		<div
			style={{
				alignItems: "center",
				borderColor: COLORS.border,
				borderWidth: 1,
				display: "flex",
				flexDirection: "row",
				flexShrink: 0,
				height: 48,
				paddingLeft: 16,
				paddingRight: 16,
			}}
		>
			<text
				style={{
					flexGrow: 1,
					fontSize: 13,
					fontWeight: 650,
					minWidth: 0,
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{view.selectedPath ?? "All changes"}
			</text>
			<text style={{ color: COLORS.faint, fontSize: 11 }}>Native diff</text>
		</div>
		{view.patch.length > 0 ? (
			<diff
				patch={view.patch}
				scroll
				style={{ flexGrow: 1, minHeight: 0, width: "100%" }}
				theme={DIFF_THEME}
				wordDiff
			/>
		) : (
			<div
				style={{
					alignItems: "center",
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					gap: 8,
					justifyContent: "center",
				}}
			>
				<text style={{ fontSize: 15, fontWeight: 650 }}>No diff to show</text>
				<text style={{ color: COLORS.faint, fontSize: 12 }}>
					Select a changed file or refresh the repository.
				</text>
			</div>
		)}
	</div>
);

interface RepositoryAppProps {
	readonly initialView: RepositoryView;
	readonly repository: GitRepository;
}

export const RepositoryApp = ({
	initialView,
	repository,
}: RepositoryAppProps): ReactNode => {
	const [view, setView] = useState(initialView);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [summary, setSummary] = useState("");
	const [description, setDescription] = useState("");
	const requestSequence = useRef(0);

	const refresh = useCallback(
		async (requestedPath: string | null): Promise<void> => {
			const requestId = requestSequence.current + 1;
			requestSequence.current = requestId;
			setBusy(true);
			setError(null);
			try {
				const nextView = await loadRepositoryView(repository, requestedPath);
				if (requestSequence.current === requestId) {
					setView(nextView);
				}
			} catch (refreshError: unknown) {
				if (requestSequence.current === requestId) {
					setError(
						refreshError instanceof Error
							? refreshError.message
							: String(refreshError)
					);
				}
			} finally {
				if (requestSequence.current === requestId) {
					setBusy(false);
				}
			}
		},
		[repository]
	);

	const mutate = useCallback(
		async (
			operation: () => Promise<GitResult<unknown>>,
			clearCommitFields = false
		): Promise<void> => {
			const requestId = requestSequence.current + 1;
			requestSequence.current = requestId;
			setBusy(true);
			setError(null);
			try {
				unwrapGitResult(await operation());
				const nextView = await loadRepositoryView(
					repository,
					view.selectedPath
				);
				if (requestSequence.current === requestId) {
					setView(nextView);
					if (clearCommitFields) {
						setSummary("");
						setDescription("");
					}
				}
			} catch (mutationError: unknown) {
				if (requestSequence.current === requestId) {
					setError(
						mutationError instanceof Error
							? mutationError.message
							: String(mutationError)
					);
				}
			} finally {
				if (requestSequence.current === requestId) {
					setBusy(false);
				}
			}
		},
		[repository, view.selectedPath]
	);

	const commit = (): void => {
		if (summary.trim().length === 0 || view.stagedFiles.length === 0) {
			return;
		}
		mutate(
			async () =>
				await repository.commit({
					description,
					summary,
				}),
			true
		);
	};

	const repositoryName = basename(view.snapshot.repository.root);
	const branch = view.snapshot.head.branch ?? "detached HEAD";

	return (
		<div style={ROOT_STYLE}>
			<Titlebar
				branch={branch}
				busy={busy}
				changeCount={view.snapshot.files.length}
				onRefresh={() => refresh(view.selectedPath)}
				repositoryName={repositoryName}
				repositoryPath={view.snapshot.repository.root}
			/>
			{error ? (
				<div
					style={{
						backgroundColor: "#fbecee",
						borderColor: "#efc9cd",
						borderRadius: 8,
						borderWidth: 1,
						marginBottom: 6,
						marginLeft: 10,
						marginRight: 10,
						padding: 9,
					}}
				>
					<text style={{ color: COLORS.danger, fontSize: 11 }}>{error}</text>
				</div>
			) : null}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					flexGrow: 1,
					minHeight: 0,
					minWidth: 0,
				}}
			>
				<Rail
					busy={busy}
					description={description}
					onCommit={commit}
					onDescriptionChange={setDescription}
					onSelect={(path) => {
						if (!busy) {
							refresh(path);
						}
					}}
					onStageAll={() => {
						mutate(async () => await repository.stageAll());
					}}
					onStageFile={(path) => {
						mutate(async () => await repository.stage({ paths: [path] }));
					}}
					onSummaryChange={setSummary}
					onUnstageAll={() => {
						mutate(async () => await repository.unstageAll());
					}}
					onUnstageFile={(path) => {
						mutate(async () => await repository.unstage({ paths: [path] }));
					}}
					summary={summary}
					view={view}
				/>
				<DiffCanvas view={view} />
			</div>
		</div>
	);
};
