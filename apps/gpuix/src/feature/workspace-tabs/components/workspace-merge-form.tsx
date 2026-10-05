import { spacing, typography, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Text } from "@1git/gpuix-ui/text";
import type { BranchInfo } from "@1git/git";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useRef, useState } from "react";
import { RepositoryList } from "../../repository-workspace/components/repository-list";
import { appTokens } from "../../../styles/tokens";
import { StateMessage } from "../../../fixture/state-message";

/** Read-only branch selection; the window owns the confirmed merge and conflict recovery. */
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
	onMerge: (target: BranchInfo) => void;
}) {
	const renderer = useGpuixRequired();
	const list = useRef<PublicInstance>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<BranchInfo | null>(null);
	const [scrollY, setScrollY] = useState(0);
	const normalizedQuery = query.trim().toLowerCase();

	const filtered = branches.filter((item) =>
		item.name.toLowerCase().includes(normalizedQuery)
	);

	const selectedVisible = filtered.some(
		(item) => item.fullName === selected?.fullName
	);

	const canMerge = !disabled && selected !== null && selectedVisible;

	const submit = (): void => {
		if (canMerge && selected) onMerge(selected);
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
				Merge into {branch}
			</Text>
			<Text tokens={appTokens} size="sm" tone="muted">
				Bring another branch’s committed changes into this branch.
			</Text>
			<input
				autoFocus
				testId="merge-branch-search"
				aria-label="Search branches to merge"
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
					label="Branches to merge"
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
						if (!busy)
							setSelected(
								filtered.find((item) => `merge-${item.fullName}` === id) ?? null
							);
					}}
				/>
			</div>
			<Text
				tokens={appTokens}
				size="sm"
				tone="muted"
				testId="merge-branch-summary"
			>
				{selectedVisible && selected
					? `Merge ${selected.name} into ${branch}. Conflicts, if any, can be resolved in Changes.`
					: "Choose a branch to merge. Your current branch stays selected."}
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
					{busy ? "Merging…" : "Merge branch"}
				</Button>
			</div>
		</div>
	);
}
