import { useRef, useState, type ReactNode } from "react";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { iconSize, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../../styles/theme";
import type { RepositoryLibraryPreferences } from "../../repository-discovery/repository-library";

type RepositoryView = RepositoryLibraryPreferences["view"];

// App-drawn glyphs share the light strokes of the Home controls.
const views = [
	{
		value: "tiles",
		label: "Tile view",
		icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
	},
	{
		value: "list",
		label: "List view",
		icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/></svg>',
	},
] as const;

/** Home's search field beside icon tabs, with roving keyboard focus and named tooltips. */
export function RepositoryLibrarySearch({
	query,
	view,
	repositoryCount,
	onBack,
	trailingAction,
	onQueryChange,
	onViewChange,
}: {
	query: string;
	view: RepositoryView;
	repositoryCount: number;
	onBack?: () => void;
	trailingAction?: ReactNode;
	onQueryChange: (query: string) => void;
	onViewChange: (view: RepositoryView) => void;
}) {
	const { tokens, colors } = useAppTheme();
	const renderer = useGpuixRequired();
	const tabs = useRef(new Map<RepositoryView, PublicInstance>());
	const search = useRef<PublicInstance>(null);

	const [searchFocused, setSearchFocused] = useState(false);

	const activate = (next: RepositoryView): void => {
		onViewChange(next);
		const tab = tabs.current.get(next);

		if (tab) renderer.focusElement?.(tab.id);
	};

	const navigate = (event: EventPayload, index: number): void => {
		if (
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			event.modifiers?.shift
		)
			return;

		if (event.key === "enter" || event.key === "space") {
			const current = views[index];

			if (!event.isHeld && current) activate(current.value);

			return;
		}

		let next: number;

		if (event.key === "left") next = (index + views.length - 1) % views.length;
		else if (event.key === "right") next = (index + 1) % views.length;
		else if (event.key === "home") next = 0;
		else if (event.key === "end") next = views.length - 1;
		else return;

		const nextView = views[next];

		if (nextView) activate(nextView.value);
	};

	return (
		<div
			testId="welcome-search-control"
			style={{
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				height: 40,
				flexShrink: 0,
				minWidth: 0,
				gap: spacing[3],
				marginBottom: spacing[3],
			}}
		>
			{onBack ? (
				<Tooltip delayDuration={400}>
					<TooltipTrigger asChild>
						<Button
							testId="welcome-back"
							tokens={tokens}
							variant="ghost"
							focusVisible={false}
							aria-label="Back to folders"
							onPress={() => {
								onBack();

								if (search.current) renderer.focusElement?.(search.current.id);
							}}
							style={{ width: 40, height: 40, paddingLeft: 0, paddingRight: 0 }}
						>
							<svg
								aria-hidden
								source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="m10 5-7 7 7 7M3 12h18"/></svg>'
								style={{
									width: iconSize.lg,
									height: iconSize.lg,
									color: tokens.colors.textMuted,
									pointerEvents: "none",
								}}
							/>
						</Button>
					</TooltipTrigger>
					<TooltipContent tokens={tokens} side="bottom" align="center">
						Back to folders
					</TooltipContent>
				</Tooltip>
			) : null}
			<div
				testId="welcome-search-field"
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					flexGrow: 1,
					flexBasis: 0,
					minWidth: 0,
					height: "100%",
					gap: spacing[2],
					borderWidth: 1,
					borderColor: searchFocused
						? tokens.colors.focusRing
						: tokens.colors.border,
					borderRadius: radius.lg,
					backgroundColor: tokens.colors.field,
					paddingLeft: spacing[3],
					paddingRight: spacing[2],
				}}
			>
				<svg
					aria-hidden
					source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>'
					style={{
						width: iconSize.lg,
						height: iconSize.lg,
						flexShrink: 0,
						color: tokens.colors.textMuted,
						pointerEvents: "none",
					}}
				/>
				<input
					ref={search}
					testId="welcome-search"
					aria-label="Search repositories"
					placeholder={`Search ${repositoryCount} ${repositoryCount === 1 ? "repository" : "repositories"}`}
					value={query}
					tabIndex={0}
					onChange={(event) => onQueryChange(event.value ?? "")}
					onFocus={() => setSearchFocused(true)}
					onBlur={() => setSearchFocused(false)}
					style={{
						...typography.md,
						flexGrow: 1,
						flexBasis: 0,
						minWidth: 0,
						height: "100%",
						color: tokens.colors.text,
						backgroundColor: "transparent",
						borderWidth: 0,
						paddingLeft: 0,
						paddingRight: spacing[1],
					}}
				/>
			</div>
			<div
				testId="welcome-view-tabs"
				role="tablist"
				aria-label="Repository view"
				aria-orientation="horizontal"
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[1],
					flexShrink: 0,
				}}
			>
				{views.map((item, index) => (
					<Tooltip key={item.value} delayDuration={400}>
						<TooltipTrigger asChild>
							<div
								ref={(tab) => {
									if (tab) tabs.current.set(item.value, tab);
									else tabs.current.delete(item.value);
								}}
								testId={`welcome-view-${item.value}`}
								role="tab"
								aria-id={`welcome-tab-${item.value}`}
								aria-label={item.label}
								aria-selected={view === item.value}
								tabIndex={view === item.value ? 0 : -1}
								onClick={() => activate(item.value)}
								onKeyDown={(event) => navigate(event, index)}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 40,
									height: 40,
									borderRadius: radius.md,
									backgroundColor:
										view === item.value ? tokens.colors.surface : "transparent",
									cursor: "pointer",
									userSelect: "none",
									hover: { backgroundColor: tokens.colors.surface },
									active: { backgroundColor: tokens.colors.surfacePressed },
								}}
							>
								<svg
									testId={`welcome-view-${item.value}-icon`}
									aria-hidden
									source={item.icon}
									style={{
										width: iconSize.lg,
										height: iconSize.lg,
										color:
											view === item.value
												? colors.brand
												: tokens.colors.textMuted,
										pointerEvents: "none",
									}}
								/>
							</div>
						</TooltipTrigger>
						<TooltipContent
							tokens={tokens}
							testId={`welcome-view-${item.value}-tooltip`}
							side="bottom"
							align="center"
						>
							{item.label}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
			{trailingAction}
		</div>
	);
}
