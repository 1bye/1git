import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	useGpuixRequired,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { radius, spacing, typography } from "@1git/design-tokens";
import { useAppTheme } from "../../styles/theme";
import {
	RepositoryQuickSwitcherModel,
	type QuickRepository,
} from "./repository-quick-switcher-model";

const rowHeight = 56;
const windowSize = 64;

/** Window-owned repository switcher; opening a result never replaces the current checkout. */
export function RepositoryQuickSwitcher({
	open,
	items,
	onClose,
	onOpen,
}: {
	open: boolean;
	items: readonly QuickRepository[];
	onClose: () => void;
	onOpen: (path: string) => void;
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
				<QuickSwitcherContent items={items} onClose={onClose} onOpen={onOpen} />
			</PopoverContent>
		</Popover>
	);
}

function QuickSwitcherContent({
	items,
	onClose,
	onOpen,
}: {
	items: readonly QuickRepository[];
	onClose: () => void;
	onOpen: (path: string) => void;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const search = useRef<PublicInstance>(null);
	const viewport = useRef<PublicInstance>(null);
	const [query, setQuery] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [start, setStart] = useState(0);

	const results = useMemo(
		() => RepositoryQuickSwitcherModel.search(items, query),
		[items, query]
	);

	const selected = Math.max(
		0,
		results.findIndex((item) => item.path === selectedPath)
	);

	const active = results[selected];
	const activePath = active?.path;
	const end = Math.min(results.length, start + windowSize);

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

	const choose = (path: string): void => {
		onClose();
		onOpen(path);
	};

	const navigate = (event: EventPayload): void => {
		if (
			event.key === "p" &&
			event.modifiers?.cmd &&
			!event.modifiers.shift &&
			!event.modifiers.alt &&
			!event.modifiers.ctrl &&
			!event.isHeld
		) {
			onClose();

			return;
		}

		if (event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt)
			return;

		if ((event.key === "down" || event.key === "up") && results.length) {
			const index =
				(selected + (event.key === "down" ? 1 : -1) + results.length) %
				results.length;

			setSelectedPath(results[index]?.path ?? null);
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
					aria-label="Search repositories"
					aria-expanded
					aria-controls="quick-switcher-results"
					aria-activedescendant={
						active ? `quick-repository-${active.path}` : undefined
					}
					tabIndex={0}
					placeholder="Search repositories, paths, or machines…"
					value={query}
					onKeyDown={navigate}
					onSubmit={() => {
						if (active) choose(active.path);
					}}
					onChange={(event) => {
						setQuery(event.value ?? "");
						setSelectedPath(null);
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
					{results.slice(start, end).map((item, offset) => (
						<div
							key={item.path}
							testId={`quick-repository-${item.path}`}
							aria-id={`quick-repository-${item.path}`}
							role="option"
							aria-selected={start + offset === selected}
							aria-label={`${item.name}, ${item.machine}, ${item.displayPath}${item.open ? ", open" : ""}`}
							tabIndex={-1}
							onClick={() => choose(item.path)}
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
								hover: { backgroundColor: tokens.colors.surfaceHover },
								cursor: "pointer",
							}}
						>
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
									{`${item.name}${item.branch ? ` / ${item.branch}` : ""}`}
								</text>
								<text
									style={{
										...typography.xs,
										color: tokens.colors.textMuted,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{`${item.machine} · ${item.displayPath}`}
								</text>
							</div>
							{item.open ? (
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
					{items.length
						? "No matching repositories."
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
