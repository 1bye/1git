import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { Keybinds } from "../keybinds/keybinds";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { radius, spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	RepositoryQuickSwitcherModel,
	type QuickRepository,
} from "./repository-quick-switcher-model";
import {
	searchRepositoryPaletteActions,
	type RepositoryPaletteAction,
} from "./repository-palette-actions";
import {
	RepositoryOverviews,
	type RepositoryOverviewState,
} from "./repository-overviews";
import { RepositoryAvatar } from "../repository-workspace/components/repository-avatar";

const rowHeight = 68;
const windowSize = 64;

type PaletteResult =
	| { readonly kind: "repository"; readonly item: QuickRepository }
	| { readonly kind: "action"; readonly item: RepositoryPaletteAction };

/** Window-owned repository switcher; opening a result never replaces the current checkout. */
export function RepositoryQuickSwitcher({
	open,
	items,
	actions = [],
	overviews,
	error,
	onClose,
	onOpen,
	onAction,
}: {
	open: boolean;
	items: readonly QuickRepository[];
	actions?: readonly RepositoryPaletteAction[];
	overviews?: RepositoryOverviews;
	error?: string | null;
	onClose: () => void;
	onOpen: (path: string) => void;
	onAction?: (id: RepositoryPaletteAction["id"]) => void;
}) {
	const { tokens } = useAppTheme();

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<PopoverContent
				testId="quick-switcher"
				aria-label="Switch repository"
				placement="center"
				width={640}
				tokens={tokens}
			>
				<QuickSwitcherContent
					items={items}
					actions={actions}
					overviews={overviews}
					error={error}
					onClose={onClose}
					onOpen={onOpen}
					onAction={onAction}
				/>
			</PopoverContent>
		</Popover>
	);
}

function QuickSwitcherContent({
	items,
	actions,
	overviews,
	error,
	onClose,
	onOpen,
	onAction,
}: {
	items: readonly QuickRepository[];
	actions: readonly RepositoryPaletteAction[];
	overviews?: RepositoryOverviews;
	error?: string | null;
	onClose: () => void;
	onOpen: (path: string) => void;
	onAction?: (id: RepositoryPaletteAction["id"]) => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const search = useRef<PublicInstance>(null);
	const viewport = useRef<PublicInstance>(null);
	const [query, setQuery] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [start, setStart] = useState(0);

	const trimmedQuery = query.trimStart();
	const actionOnly = trimmedQuery.startsWith(">");

	const searchQuery = actionOnly ? trimmedQuery.slice(1) : query;

	const results = useMemo<readonly PaletteResult[]>(() => {
		const repositories = actionOnly
			? []
			: RepositoryQuickSwitcherModel.search(items, searchQuery).map((item) => ({
					kind: "repository" as const,
					item,
				}));

		const commands = searchRepositoryPaletteActions(actions, searchQuery).map(
			(item) => ({ kind: "action" as const, item })
		);

		return [...repositories, ...commands];
	}, [actionOnly, actions, items, searchQuery]);

	const selected = Math.max(
		0,
		results.findIndex((result) => resultKey(result) === selectedKey)
	);

	const active = results[selected];

	const activePath =
		active?.kind === "repository" ? active.item.path : undefined;

	const end = Math.min(results.length, start + windowSize);

	useEffect(() => {
		if (!overviews) return;

		overviews.setVisible(
			results
				.slice(start, end)
				.flatMap((result) =>
					result.kind === "repository" ? [result.item.path] : []
				)
		);

		return () => overviews.setVisible([]);
	}, [end, overviews, results, start]);

	useEffect(() => {
		// Native controls may not exist during the dialog's first focus traversal.
		const timer = setTimeout(() => {
			if (search.current) renderer.focusElement?.(search.current.id);
		}, 0);

		return () => clearTimeout(timer);
	}, [renderer]);

	useLayoutEffect(() => {
		if (viewport.current && activePath)
			renderer.scrollToItem?.(viewport.current.id, selected, 0);
	}, [renderer, selected, activePath]);

	const choose = (result: PaletteResult): void => {
		if (result.kind === "action" && !result.item.enabled) return;

		onClose();

		if (result.kind === "repository") onOpen(result.item.path);
		else onAction?.(result.item.id);
	};

	const navigate = (event: EventPayload): void => {
		if (Keybinds.matches(event, "quick-open", renderer)) {
			onClose();

			return;
		}

		if (event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt)
			return;

		if ((event.key === "down" || event.key === "up") && results.length) {
			const repositoryIndexes = results.flatMap((result, index) =>
				result.kind === "repository" ? [index] : []
			);

			const indexes =
				actionOnly || repositoryIndexes.length === 0
					? results.map((_result, index) => index)
					: repositoryIndexes;

			const current = Math.max(0, indexes.indexOf(selected));

			const index =
				indexes[
					(current + (event.key === "down" ? 1 : -1) + indexes.length) %
						indexes.length
				] ?? 0;

			setSelectedKey(results[index] ? resultKey(results[index]) : null);
			setStart(Math.max(0, index - Math.floor(windowSize / 2)));
		}
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
			<div
				style={{
					position: "relative",
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: spacing[2],
					height: 44,
					borderRadius: radius.md,
					borderWidth: 1,
					borderColor: tokens.colors.border,
					backgroundColor: tokens.colors.field,
					paddingLeft: spacing[3],
					paddingRight: spacing[3],
				}}
			>
				<svg
					aria-hidden
					source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>'
					style={{
						width: 18,
						height: 18,
						flexShrink: 0,
						color: tokens.colors.textMuted,
						pointerEvents: "none",
					}}
				/>
				<input
					ref={search}
					testId="quick-switcher-search"
					role="combobox"
					aria-label="Search repositories and actions"
					aria-expanded
					aria-controls="quick-switcher-results"
					aria-activedescendant={active ? resultTestId(active) : undefined}
					tabIndex={0}
					placeholder="Search repositories, actions, paths, or machines…"
					value={query}
					onKeyDown={navigate}
					onSubmit={() => {
						if (active) choose(active);
					}}
					onChange={(event) => {
						setQuery(event.value ?? "");
						setSelectedKey(null);
						setStart(0);
					}}
					style={{
						...typography.md,
						flexGrow: 1,
						flexBasis: 0,
						minWidth: 0,
						height: "100%",
						paddingLeft: 0,
						paddingRight: 0,
						borderWidth: 0,
						backgroundColor: "transparent",
						color: tokens.colors.text,
					}}
				/>
			</div>
			{error ? (
				<text
					testId="quick-switcher-error"
					role="alert"
					style={{ ...typography.xs, color: tokens.colors.danger }}
				>
					{error}
				</text>
			) : null}
			{results.length ? (
				<virtual-list
					key={query}
					ref={viewport}
					testId="quick-switcher-results"
					aria-id="quick-switcher-results"
					role="listbox"
					aria-label="Repositories"
					itemCount={results.length}
					estimatedItemHeight={rowHeight}
					windowStart={start}
					overdraw={rowHeight * 2}
					onVisibleRange={() => {
						const anchor =
							viewport.current &&
							renderer.getListScrollTop?.(viewport.current.id);

						const first = anchor?.[0] ?? 0;

						if (first < start || first + 8 > end)
							setStart(Math.max(0, first - 16));
					}}
					style={{
						height: 7 * rowHeight,
						flexShrink: 0,
					}}
				>
					{results.slice(start, end).map((result, offset) => (
						<div
							key={resultKey(result)}
							testId={resultTestId(result)}
							aria-id={resultTestId(result)}
							role="option"
							aria-selected={start + offset === selected}
							aria-disabled={result.kind === "action" && !result.item.enabled}
							aria-label={resultLabel(result)}
							tabIndex={-1}
							onClick={() => choose(result)}
							style={{
								height: rowHeight,
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: spacing[3],
								paddingLeft: spacing[3],
								paddingRight: spacing[3],
								borderRadius: radius.md,
								backgroundColor:
									start + offset === selected
										? tokens.colors.surface
										: "transparent",
								opacity:
									result.kind === "action" && !result.item.enabled ? 0.5 : 1,
								hover: { backgroundColor: tokens.colors.surfaceHover },
								cursor: "pointer",
							}}
						>
							{result.kind === "repository" ? (
								<RepositoryAvatar
									label={result.item.name}
									source={{ path: result.item.path }}
									size={32}
									testId={`quick-avatar-${result.item.path}`}
								/>
							) : (
								<div
									style={{
										width: 32,
										height: 32,
										flexShrink: 0,
										alignItems: "center",
										justifyContent: "center",
										borderRadius: radius.md,
										backgroundColor: tokens.colors.field,
									}}
								>
									<text
										style={{ ...typography.sm, color: tokens.colors.textMuted }}
									>
										⌘
									</text>
								</div>
							)}
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: spacing[0.5],
									flexGrow: 1,
									minWidth: 0,
									pointerEvents: "none",
								}}
							>
								<text
									style={{
										...typography.sm,
										color: tokens.colors.text,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{result.kind === "repository"
										? result.item.name
										: result.item.label}
								</text>
								{result.kind === "repository" ? (
									<>
										<QuickRepositoryStatus
											item={result.item}
											overviews={overviews}
										/>
										<text
											style={{
												...typography["2xs"],
												color: tokens.colors.textMuted,
												whiteSpace: "nowrap",
												textOverflow: "ellipsis",
											}}
										>
											{`${result.item.machine} · ${result.item.displayPath}`}
										</text>
									</>
								) : (
									<text
										style={{
											...typography.xs,
											color: tokens.colors.textMuted,
											whiteSpace: "nowrap",
											textOverflow: "ellipsis",
										}}
									>
										{`${result.item.hint ? `${result.item.hint} · ` : ""}${result.item.id.startsWith("settings:") ? "Settings" : "Command"}`}
									</text>
								)}
							</div>
							{result.kind === "repository" && result.item.open ? (
								<text
									style={{
										...typography.xs,
										color: tokens.colors.textMuted,
										pointerEvents: "none",
										flexShrink: 0,
									}}
								>
									Open
								</text>
							) : null}
						</div>
					))}
				</virtual-list>
			) : (
				<text
					testId="quick-switcher-empty"
					style={{
						...typography.sm,
						color: tokens.colors.textMuted,
						padding: spacing[4],
						height: 7 * rowHeight,
					}}
				>
					{items.length || actions.length
						? "No matching repositories or actions."
						: "No repositories yet. Open one from disk or add an SSH machine on Home."}
				</text>
			)}
			<text
				style={{
					...typography.xs,
					color: tokens.colors.textMuted,
					padding: spacing[2],
				}}
			>
				↑ ↓ Navigate ↵ Open Esc Close
			</text>
		</div>
	);
}

function resultKey(result: PaletteResult): string {
	return result.kind === "repository"
		? `repository:${result.item.path}`
		: `action:${result.item.id}`;
}

function resultTestId(result: PaletteResult): string {
	return result.kind === "repository"
		? `quick-repository-${result.item.path}`
		: `quick-action-${result.item.id}`;
}

function resultLabel(result: PaletteResult): string {
	if (result.kind === "action")
		return `${result.item.label}${result.item.enabled ? "" : ", unavailable"}`;

	return `${result.item.name}, ${result.item.machine}, ${result.item.displayPath}${result.item.open ? ", open" : ""}`;
}

function QuickRepositoryStatus({
	item,
	overviews,
}: {
	item: QuickRepository;
	overviews?: RepositoryOverviews;
}) {
	const { tokens } = useAppTheme();

	const subscribe = useCallback(
		(listener: () => void) =>
			overviews?.subscribe(item.path, listener) ?? (() => {}),
		[overviews, item.path]
	);

	const snapshot = useCallback(
		(): RepositoryOverviewState | null => overviews?.read(item.path) ?? null,
		[overviews, item.path]
	);

	const state = useSyncExternalStore(subscribe, snapshot);

	const detail = (() => {
		if (!state)
			return item.branch ? `Branch ${item.branch}` : "Checking status…";

		if (state.status === "loading")
			return item.branch
				? `Branch ${item.branch} · Checking status…`
				: "Checking status…";

		if (state.status === "unavailable")
			return item.branch
				? `Branch ${item.branch} · Status unavailable`
				: "Status unavailable";

		const { branch, changes, ahead, behind } = state.value;

		const sync =
			ahead === null || behind === null ? "" : ` · ↓${behind} ↑${ahead}`;

		return `Branch ${branch} · ${changes ? `${changes} changed` : "Clean"}${sync}`;
	})();

	return (
		<text
			testId={`quick-status-${item.path}`}
			style={{
				...typography.xs,
				color: tokens.colors.textMuted,
				whiteSpace: "nowrap",
				textOverflow: "ellipsis",
				pointerEvents: "none",
			}}
		>
			{detail}
		</text>
	);
}
