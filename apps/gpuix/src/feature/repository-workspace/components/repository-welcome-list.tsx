import {
	use,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
} from "react";
import {
	useGpuixRequired,
	useWindowSize,
	type PublicInstance,
} from "@gpuix/react";
import {
	RepositoryWelcomeRow,
	repositoryTileSize,
} from "./repository-welcome-row";
import { spacing } from "@1git/design-tokens";
import { RepositoryAvatarContext } from "./repository-avatar";
import { RepositoryOverviewContext } from "./repository-overview";

const chunkSize = 40;
const tileGap = spacing[3];
const tileMinWidth = repositoryTileSize.minWidth;

/** Buffers large discovery lists so a home-folder scan cannot mount thousands of native controls at once. */
export function RepositoryWelcomeList({
	paths,
	saved,
	starred,
	busy,
	onOpen,
	onForget,
	onStar,
	onMenu,
	layout,
	query = "",
	testIdPrefix = "welcome-",
}: {
	paths: readonly string[];
	saved: ReadonlySet<string>;
	starred: ReadonlySet<string>;
	busy: boolean;
	onOpen: (path: string) => void;
	onForget?: (path: string) => void;
	onStar?: (path: string) => void;
	onMenu?: ComponentProps<typeof RepositoryWelcomeRow>["onMenu"];
	layout: "tiles" | "list";
	query?: string;
	testIdPrefix?: string;
}) {
	const renderer = useGpuixRequired();
	const avatars = use(RepositoryAvatarContext);
	const overviews = use(RepositoryOverviewContext);
	const window = useWindowSize();
	const container = useRef<PublicInstance>(null);
	const viewport = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const focus = useRef<number | null>(null);
	const [windowStart, setWindowStart] = useState(0);
	const [columns, setColumns] = useState(1);
	const columnCount = layout === "tiles" ? columns : 1;

	useLayoutEffect(() => {
		// Reset search scrolling without discarding the measured grid width.
		focus.current = null;
		setWindowStart(0);

		if (viewport.current) renderer.scrollToItem?.(viewport.current.id, 0, 0);
	}, [query, renderer]);

	const rowHeight =
		layout === "tiles" ? repositoryTileSize.height + tileGap : 58;

	const rowCount = Math.ceil(paths.length / columnCount);
	const windowSize = Math.ceil(window.height / rowHeight) + chunkSize * 2;
	const start = Math.min(windowStart, Math.max(0, rowCount - windowSize));
	const end = Math.min(rowCount, start + windowSize);

	const preloadAvatars = useCallback((): void => {
		const bounds =
			container.current && renderer.getElementBounds?.(container.current.id);

		if (bounds)
			setColumns(
				Math.max(
					1,
					Math.floor((bounds.width + tileGap) / (tileMinWidth + tileGap))
				)
			);

		if (!avatars && !overviews) return;

		const anchor = viewport.current
			? renderer.getListScrollTop?.(viewport.current.id)
			: undefined;

		const first = Math.max(0, (anchor?.[0] ?? 0) - 1);

		const count = anchor
			? Math.ceil(((anchor[1] ?? 0) + (anchor[2] ?? 0)) / rowHeight) + 3
			: 12;

		const visible = paths.slice(
			first * columnCount,
			(first + count) * columnCount
		);

		overviews?.setVisible(visible);

		for (const path of visible) void avatars?.load({ path });
	}, [avatars, overviews, paths, renderer, columnCount, rowHeight]);

	useEffect(() => () => overviews?.setVisible([]), [overviews]);

	useEffect(() => {
		// The first native paint can precede registration of the visible-range callback.
		const timer = setTimeout(preloadAvatars, 0);

		return () => clearTimeout(timer);
	}, [preloadAvatars, window.width]);

	const reveal = (index: number): boolean => {
		const path = paths[index];
		const row = path ? rows.current.get(path) : undefined;

		if (!row || !viewport.current) return false;

		renderer.focusElement?.(row.id);
		renderer.scrollToItem?.(
			viewport.current.id,
			Math.floor(index / columnCount),
			0
		);

		return true;
	};

	useLayoutEffect(() => {
		const index = focus.current;

		if (index !== null && reveal(index)) focus.current = null;
	});

	return (
		<div
			ref={container}
			testId={`${testIdPrefix}repositories-viewport`}
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				flexBasis: 0,
				minHeight: 0,
			}}
		>
			<virtual-list
				ref={viewport}
				testId={`${testIdPrefix}repositories`}
				role="group"
				aria-label="Repositories"
				aria-description="Use the arrow keys, Home and End to move between repositories."
				itemCount={rowCount}
				estimatedItemHeight={rowHeight}
				windowStart={start}
				overdraw={rowHeight * 2}
				onVisibleRange={() => {
					preloadAvatars();
					const anchor =
						viewport.current &&
						renderer.getListScrollTop?.(viewport.current.id);

					const first = anchor?.[0] ?? 0;

					if (
						first < start ||
						first + Math.ceil(window.height / rowHeight) > end - chunkSize / 2
					)
						setWindowStart(
							Math.max(0, Math.floor(first / chunkSize) * chunkSize - chunkSize)
						);
				}}
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					flexBasis: 0,
					height: "100%",
					minHeight: 0,
				}}
			>
				{Array.from({ length: end - start }, (_, offset) => start + offset).map(
					(rowIndex) => (
						<div
							key={paths[rowIndex * columnCount]}
							style={{
								height: rowHeight,
								paddingBottom: layout === "tiles" ? tileGap : spacing[1],
								display: "flex",
								flexDirection: "row",
								gap: tileGap,
							}}
						>
							{paths
								.slice(rowIndex * columnCount, (rowIndex + 1) * columnCount)
								.map((path, column) => (
									<RepositoryWelcomeRow
										key={path}
										testIdPrefix={testIdPrefix}
										layout={layout}
										deferAvatar
										path={path}
										busy={busy}
										suggested={!saved.has(path)}
										starred={starred.has(path)}
										onStar={onStar}
										onOpen={onOpen}
										onForget={onForget}
										onMenu={onMenu}
										openRef={(row) => {
											if (row) rows.current.set(path, row);
											else rows.current.delete(path);
										}}
										onNavigate={(event) => {
											if (
												busy ||
												event.modifiers?.cmd ||
												event.modifiers?.ctrl ||
												event.modifiers?.alt
											)
												return;

											const index = rowIndex * columnCount + column;

											const destinations: Readonly<Record<string, number>> = {
												home: 0,
												end: paths.length - 1,
												up: index - columnCount,
												down: index + columnCount,
												...(layout === "tiles"
													? { left: index - 1, right: index + 1 }
													: {}),
											};

											const destination = destinations[event.key ?? ""];

											if (destination === undefined) return;

											focus.current = Math.max(
												0,
												Math.min(paths.length - 1, destination)
											);

											if (reveal(focus.current)) {
												focus.current = null;

												return;
											}

											setWindowStart(
												Math.max(
													0,
													Math.floor(focus.current / columnCount / chunkSize) *
														chunkSize -
														chunkSize
												)
											);
										}}
									/>
								))}
							{Array.from(
								{
									length: Math.max(
										0,
										columnCount -
											Math.min(
												columnCount,
												paths.length - rowIndex * columnCount
											)
									),
								},
								(_, column) => (
									<div
										key={`empty-${column}`}
										style={{
											flexGrow: 1,
											flexBasis: tileMinWidth,
											minWidth: repositoryTileSize.minWidth,
											maxWidth: repositoryTileSize.maxWidth,
										}}
									/>
								)
							)}
						</div>
					)
				)}
			</virtual-list>
		</div>
	);
}
