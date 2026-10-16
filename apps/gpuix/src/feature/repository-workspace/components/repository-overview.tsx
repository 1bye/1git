import { createContext, use, useCallback, useSyncExternalStore } from "react";
import { spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../../styles/theme";
import { RepositoryOverviews } from "../../repository-discovery/repository-overviews";

/** Home shares a bounded status queue; standalone rows perform no Git I/O. */
export const RepositoryOverviewContext =
	createContext<RepositoryOverviews | null>(null);

/** Branch and working-tree/tracking counts, with explicit loading and unavailable states. */
export function RepositoryOverviewDetails({
	path,
	layout = "list",
}: {
	path: string;
	layout?: "tiles" | "list";
}) {
	const overviews = use(RepositoryOverviewContext);
	const { tokens, colors } = useAppTheme();

	const subscribe = useCallback(
		(listener: () => void) =>
			overviews?.subscribe(path, listener) ?? (() => {}),
		[overviews, path]
	);

	const snapshot = useCallback(
		() => overviews?.read(path) ?? null,
		[overviews, path]
	);

	const state = useSyncExternalStore(subscribe, snapshot);

	if (!state) return null;

	const textStyle = {
		...typography.xs,
		color: tokens.colors.textMuted,
		whiteSpace: "nowrap" as const,
		textOverflow: "ellipsis" as const,
		pointerEvents: "none" as const,
	};

	if (state.status !== "ready")
		return (
			<text
				testId={`welcome-status-${path}`}
				aria-description={
					state.status === "unavailable" ? state.message : undefined
				}
				style={textStyle}
			>
				{state.status === "loading"
					? "Checking status…"
					: state.message === "Machine disconnected"
						? "Disconnected"
						: "Status unavailable"}
			</text>
		);

	const { branch, changes, ahead, behind } = state.value;

	return (
		<div
			testId={`welcome-status-${path}`}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: layout === "tiles" ? spacing[1] : spacing[0.5],
				width: "100%",
				minWidth: 0,
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[1],
					minWidth: 0,
					pointerEvents: "none",
				}}
			>
				<svg
					aria-hidden
					source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2a4 4 0 0 1-4 4H6"/></svg>'
					style={{
						width: 12,
						height: 12,
						flexShrink: 0,
						color: tokens.colors.textMuted,
						pointerEvents: "none",
					}}
				/>
				<text
					testId={`welcome-branch-${path}`}
					aria-label={`Branch ${branch}`}
					style={{ ...textStyle, minWidth: 0, flexGrow: 1 }}
				>
					{branch}
				</text>
			</div>
			<div
				aria-label={`${changes} uncommitted files${ahead === null || behind === null ? ", no upstream branch" : `, ${behind} incoming commits, ${ahead} outgoing commits, based on the last fetch`}`}
				style={{
					display: "flex",
					flexDirection: "row",
					gap: spacing[2],
					alignItems: "center",
					pointerEvents: "none",
				}}
			>
				<text
					testId={`welcome-changes-${path}`}
					style={{
						...textStyle,
						color: changes ? tokens.colors.text : colors.success,
					}}
				>
					{changes ? `${changes} changed` : "Clean"}
				</text>
				<text testId={`welcome-sync-${path}`} style={textStyle}>
					{ahead === null || behind === null
						? "No upstream"
						: `↓${behind} ↑${ahead}`}
				</text>
			</div>
		</div>
	);
}
