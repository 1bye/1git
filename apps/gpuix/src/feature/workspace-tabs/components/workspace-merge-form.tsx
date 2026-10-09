import { spacing, typography, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Textarea } from "@1git/gpuix-ui/textarea";
import { Text } from "@1git/gpuix-ui/text";
import type { BranchInfo } from "@1git/git";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useRef, useState } from "react";
import { RepositoryList } from "../../repository-workspace/components/repository-list";
import { appTokens } from "../../../styles/tokens";
import { StateMessage } from "../../../fixture/state-message";

type IntegrationKind = "merge" | "squash-merge" | "rebase";
const modeLabels = {
	merge: "Merge",
	"squash-merge": "Squash merge",
	rebase: "Rebase",
} as const;

/** Read-only integration review; the window owns the confirmed write and conflict recovery. */
export function WorkspaceMergeForm({
	branch,
	branches,
	disabled,
	busy,
	onCancel,
	onMerge,
}: {
	branch: string;
	branches: readonly BranchInfo[];
	disabled: boolean;
	busy: boolean;
	onCancel: () => void;
	onMerge: (
		target: BranchInfo,
		kind: IntegrationKind,
		message?: string
	) => void;
}) {
	const renderer = useGpuixRequired();
	const list = useRef<PublicInstance>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<BranchInfo | null>(null);
	const [scrollY, setScrollY] = useState(0);
	const [kind, setKind] = useState<IntegrationKind>("merge");
	const [message, setMessage] = useState<string | null>(null);
	const normalizedQuery = query.trim().toLowerCase();

	const filtered = branches.filter((item) =>
		item.name.toLowerCase().includes(normalizedQuery)
	);

	const selectedVisible = filtered.some(
		(item) => item.fullName === selected?.fullName
	);

	const squashMessage =
		message ?? (selected ? `Squash merge ${selected.name} into ${branch}` : "");

	const canMerge =
		!disabled &&
		!busy &&
		selected !== null &&
		selectedVisible &&
		(kind !== "squash-merge" ||
			(!!squashMessage.split("\n", 1)[0]?.trim() &&
				!squashMessage.includes("\0")));

	const submit = (): void => {
		if (canMerge && selected)
			onMerge(
				selected,
				kind,
				kind === "squash-merge" ? squashMessage : undefined
			);
	};

	return (
		<div
			testId="merge-branch-form"
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				padding: spacing[2],
				gap: spacing[2],
			}}
		>
			<Text tokens={appTokens} weight="medium">
				{kind === "rebase"
					? `Rebase ${branch} onto…`
					: `${modeLabels[kind]} into ${branch}`}
			</Text>
			<div
				role="group"
				aria-label="Branch integration method"
				style={{
					display: "flex",
					flexDirection: "row",
					gap: spacing[1],
					flexShrink: 0,
				}}
			>
				{(["merge", "squash-merge", "rebase"] as const).map((mode) => (
					<Button
						key={mode}
						testId={`integration-${mode}`}
						tokens={appTokens}
						size="sm"
						variant={kind === mode ? "secondary" : "ghost"}
						aria-label={`${modeLabels[mode]}${kind === mode ? ", selected" : ""}`}
						disabled={busy}
						onPress={() => setKind(mode)}
						style={{
							flexGrow: 1,
							paddingLeft: spacing[1],
							paddingRight: spacing[1],
						}}
					>
						{modeLabels[mode]}
					</Button>
				))}
			</div>
			<input
				autoFocus
				testId="merge-branch-search"
				aria-label={
					kind === "rebase"
						? "Search branches to rebase onto"
						: "Search branches to merge"
				}
				placeholder="Search branches…"
				value={query}
				readOnly={busy}
				onChange={(event) => {
					setQuery(event.value ?? "");
					setScrollY(0);
					setSelected(null);
				}}
				onKeyDown={(event) => {
					if (event.key !== "down" || busy) return;

					if (list.current) renderer.focusNextWithin?.(list.current.id);
				}}
				style={{
					...typography.md,
					width: "100%",
					height: 30,
					flexShrink: 0,
					paddingLeft: spacing[2.5],
					paddingRight: spacing[2.5],
					borderRadius: radius.md,
					borderWidth: 1,
					borderColor: appTokens.colors.border,
					backgroundColor: appTokens.colors.field,
				}}
			/>
			<div
				ref={list}
				onKeyDown={(event) => {
					if (event.key === "enter") submit();
				}}
				style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
			>
				<RepositoryList
					key={query}
					testId="merge-branch-list"
					label={
						kind === "rebase" ? "Branches to rebase onto" : "Branches to merge"
					}
					emptyMessage="No matching branches."
					emptyContent={
						<StateMessage
							artwork="search"
							title="No matching branches"
							compact
						/>
					}
					entries={filtered.map((item) => ({
						id: `merge-${item.fullName}`,
						title: item.name,
					}))}
					state={{
						selectedId:
							selectedVisible && selected ? `merge-${selected.fullName}` : null,
						scrollY,
					}}
					onScroll={setScrollY}
					onSelect={(id) => {
						if (!busy) {
							setSelected(
								filtered.find((item) => `merge-${item.fullName}` === id) ?? null
							);
							setMessage(null);
						}
					}}
				/>
			</div>
			{kind === "squash-merge" ? (
				<Textarea
					testId="squash-merge-message"
					aria-label="Squash commit message"
					value={squashMessage}
					readOnly={busy}
					placeholder="Commit message…"
					onValueChange={setMessage}
					tokens={appTokens}
					style={{ height: 54, flexShrink: 0, ...typography.sm }}
				/>
			) : null}
			<Text
				tokens={appTokens}
				size="sm"
				tone="muted"
				testId="merge-branch-summary"
			>
				{selectedVisible && selected
					? kind === "rebase"
						? `Replay ${branch} onto ${selected.name}. Only unpublished commits can be rewritten.`
						: kind === "squash-merge"
							? `Combine ${selected.name} into one new commit on ${branch}. The source branch is kept.`
							: `Merge ${selected.name} into ${branch}. Conflicts can be resolved in Changes.`
					: "Choose another branch. Your current branch stays selected."}
			</Text>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					gap: spacing[2],
					flexShrink: 0,
				}}
			>
				<Button
					tokens={appTokens}
					testId="cancel-merge-branch"
					size="sm"
					variant="secondary"
					disabled={busy}
					onPress={onCancel}
				>
					Cancel
				</Button>
				<Button
					tokens={appTokens}
					testId="confirm-merge-branch"
					size="sm"
					disabled={!canMerge}
					onPress={submit}
				>
					{busy
						? kind === "rebase"
							? "Rebasing…"
							: "Merging…"
						: kind === "merge"
							? "Merge branch"
							: modeLabels[kind]}
				</Button>
			</div>
		</div>
	);
}
