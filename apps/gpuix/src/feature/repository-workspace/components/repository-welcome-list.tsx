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
import { RepositoryWelcomeRow } from "./repository-welcome-row";
import { spacing } from "@1git/design-tokens";
import { RepositoryAvatarContext } from "./repository-avatar";

const rowHeight = 58;
const chunkSize = 40;

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
}: {
	paths: readonly string[];
	saved: ReadonlySet<string>;
	starred: ReadonlySet<string>;
	busy: boolean;
	onOpen: (path: string) => void;
	onForget: (path: string) => void;
	onStar: (path: string) => void;
	onMenu: ComponentProps<typeof RepositoryWelcomeRow>["onMenu"];
}) {
	const renderer = useGpuixRequired();
	const avatars = use(RepositoryAvatarContext);
	const window = useWindowSize();
	const viewport = useRef<PublicInstance>(null);
	const rows = useRef(new Map<string, PublicInstance>());
	const focus = useRef<number | null>(null);
	const [windowStart, setWindowStart] = useState(0);
	const windowSize = Math.ceil(window.height / rowHeight) + chunkSize * 2;
	const start = Math.min(windowStart, Math.max(0, paths.length - windowSize));
	const end = Math.min(paths.length, start + windowSize);

	const preloadAvatars = useCallback((): void => {
		if (!avatars) return;

		const anchor = viewport.current
			? renderer.getListScrollTop?.(viewport.current.id)
			: undefined;

		const first = Math.max(0, (anchor?.[0] ?? 0) - 1);

		const count = anchor
			? Math.ceil(((anchor[1] ?? 0) + (anchor[2] ?? 0)) / rowHeight) + 3
			: 12;

		for (const path of paths.slice(first, first + count))
			void avatars.load({ path });
	}, [avatars, paths, renderer]);

	useEffect(() => {
		// The first native paint can precede registration of the visible-range callback.
		const timer = setTimeout(preloadAvatars, 0);

		return () => clearTimeout(timer);
	}, [preloadAvatars]);

	const reveal = (index: number): boolean => {
		const path = paths[index];
		const row = path ? rows.current.get(path) : undefined;

		if (!row || !viewport.current) return false;

		renderer.focusElement?.(row.id);
		renderer.scrollToItem?.(viewport.current.id, index, 0);

		return true;
	};

	useLayoutEffect(() => {
		const index = focus.current;

		if (index !== null && reveal(index)) focus.current = null;
	});

	return (
		<div
			testId="welcome-repositories-viewport"
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
				testId="welcome-repositories"
				role="group"
				aria-label="Repositories"
				aria-description="Use Up, Down, Home and End to move between repositories."
				itemCount={paths.length}
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
				{paths.slice(start, end).map((path, offset) => (
					<div
						key={path}
						style={{ height: rowHeight, paddingBottom: spacing[1] }}
					>
						<RepositoryWelcomeRow
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

								const index = start + offset;

								const destinations: Readonly<Record<string, number>> = {
									home: 0,
									end: paths.length - 1,
									up: index - 1,
									down: index + 1,
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
										Math.floor(focus.current / chunkSize) * chunkSize -
											chunkSize
									)
								);
							}}
						/>
					</div>
				))}
			</virtual-list>
		</div>
	);
}
