import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { spacing, typography, fontWeight, iconSize } from "@1git/design-tokens";
import {
	useMemo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
	type ReactNode,
} from "react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import {
	useGpuixRequired,
	useWindowSize,
	type EventPayload,
	type PublicInstance,
} from "@gpuix/react";
import { NativeFileMenu } from "../lib/native-file-menu";
import { RepositoryFileActions } from "../lib/repository-file-actions";

import { StateMessage } from "../../../fixture/state-message";
import { RepositoryWelcomeRow } from "./repository-welcome-row";
import { RepositoryWelcomeList } from "./repository-welcome-list";
import type { useRepositoryDiscovery } from "../../repository-discovery/use-repository-discovery";
import { RepositoryDiscoveryRail } from "../../repository-discovery/repository-discovery-rail";
import {
	RepositoryLibrary,
	type RepositoryLibraryPreferences,
	type RepositoryFolderGroup,
} from "../../repository-discovery/repository-library";
import {
	RepositoryAddFolderTile,
	RepositoryFolderTile,
} from "./repository-folder-tile";
import { RepositoryLibrarySearch } from "./repository-library-search";
import { RepositoryOverviews } from "../../repository-discovery/repository-overviews";
import { RepositoryOverviewContext } from "./repository-overview";
import type { RepositoryReader } from "../lib/repository-reader";
import type { RepositoryWorkspaceState } from "../lib/repository-workspace-model";

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const styles = StyleSheet.create({
		page: {
			position: "relative",
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			flexBasis: 0,
			minHeight: 0,
			overflowY: "hidden",
			padding: spacing[10],
			alignItems: "center",
		},
		columns: {
			display: "flex",
			flexDirection: "row",
			alignItems: "stretch",
			flexGrow: 1,
			minHeight: 0,
			width: "100%",
			maxWidth: 980,
			gap: spacing[16],
		},
		list: {
			display: "flex",
			flexDirection: "column",
			flexGrow: 1,
			flexBasis: 0,
			minHeight: 0,
			overflowY: "scroll",
			overflowX: "hidden",
			gap: spacing[1],
		},
		heading: {
			...typography.xs,
			fontWeight: fontWeight.medium,
			color: appTokens.colors.textMuted,
			marginBottom: spacing[3],
			marginLeft: spacing[2.5],
		},
		hint: { ...typography.sm, color: appTokens.colors.textMuted },
		action: {
			width: "100%",
			justifyContent: "flex-start",
			gap: spacing[2.5],
			color: appTokens.colors.textMuted,
		},
	});

	return { styles };
});

interface RepositoryWelcomeProps {
	paths: readonly string[];
	library: RepositoryLibraryPreferences;
	onLibraryChange: Dispatch<SetStateAction<RepositoryLibraryPreferences>>;
	savedPaths?: readonly string[];
	discovery?: ReturnType<typeof useRepositoryDiscovery>;
	actions: ReactNode;
	busy: boolean;
	error?: string | null;
	onOpen: () => void;
	onOpenRecent: (path: string) => void;
	onForget: (path: string) => void;
	machines?: ReactNode;
	remote?: boolean;
	readRepository: typeof RepositoryReader.read;
	canReadRepository: (path: string) => boolean;
	openWorkspaces: readonly RepositoryWorkspaceState[];
}

/** Launch page with machine selection, quick actions and a searchable repository library. */
export function RepositoryWelcome(props: RepositoryWelcomeProps) {
	const { readRepository, canReadRepository, openWorkspaces } = props;

	const overviews = useMemo(
		() => new RepositoryOverviews(readRepository, canReadRepository),
		[readRepository, canReadRepository]
	);

	useLayoutEffect(() => {
		overviews.setOpen(openWorkspaces);
	});
	useEffect(() => {
		const timer = setInterval(() => overviews.refresh(), 15000);

		return () => {
			clearInterval(timer);
			overviews.dispose();
		};
	}, [overviews]);

	return (
		<RepositoryOverviewContext value={overviews}>
			<RepositoryWelcomeContent {...props} overviews={overviews} />
		</RepositoryOverviewContext>
	);
}

function RepositoryWelcomeContent({
	paths,
	library,
	onLibraryChange,
	savedPaths = paths,
	discovery,
	actions,
	busy,
	error,
	onOpen,
	onOpenRecent,
	onForget,
	machines,
	remote = false,
	overviews,
}: RepositoryWelcomeProps & { overviews: RepositoryOverviews }) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	const [query, setQuery] = useState("");
	const searchQuery = query.trim().toLowerCase();
	const refresh = discovery?.refresh;

	useEffect(() => {
		if (!searchQuery || !refresh) return;

		const controller = new AbortController();

		const timer = setTimeout(() => {
			void refresh(searchQuery, controller.signal);
		}, 200);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [refresh, searchQuery]);
	const [menuError, setMenuError] = useState<string | null>(null);
	const renderer = useGpuixRequired();
	const window = useWindowSize();
	const libraryViewport = useRef<PublicInstance>(null);
	const favoriteButtons = useRef(new Map<string, PublicInstance>());
	const folderActions = useRef<PublicInstance>(null);
	const starred = useMemo(() => new Set(library.starred), [library.starred]);

	const folders = useMemo(
		() => RepositoryLibrary.groups(paths, discovery?.folders ?? []),
		[paths, discovery?.folders]
	);

	const selectedFolder = folders.find((folder) => folder.id === library.folder);

	const unavailable = discovery?.folders.some(
		(folder) =>
			folder.path === library.folder && folder.status === "unavailable"
	);

	const inFolder = !!library.folder;
	const showFolders = !inFolder && !query.trim();

	const favorites = useMemo(
		() => paths.filter((path) => starred.has(path)),
		[paths, starred]
	);

	const measureFavorites = useCallback((): boolean => {
		const viewport =
			libraryViewport.current &&
			renderer.getElementBounds?.(libraryViewport.current.id);

		if (!viewport?.height) return false;

		overviews.setVisible(
			favorites.filter((path) => {
				const button = favoriteButtons.current.get(path);
				const bounds = button && renderer.getElementBounds?.(button.id);

				return (
					!!bounds &&
					bounds.height > 0 &&
					bounds.y < viewport.y + viewport.height &&
					bounds.y + bounds.height > viewport.y
				);
			})
		);

		return true;
	}, [favorites, overviews, renderer]);

	useEffect(() => {
		if (!showFolders) return;

		// Retry until the native viewport has painted, then update only on scroll/resize.
		const timer = setInterval(() => {
			if (measureFavorites()) clearInterval(timer);
		}, 16);

		return () => {
			clearInterval(timer);
			overviews.setVisible([]);
		};
	}, [showFolders, measureFavorites, overviews, window.width, window.height]);

	const onStar = (path: string): void =>
		onLibraryChange((current) =>
			RepositoryLibrary.star(current, path, !current.starred.includes(path))
		);

	const navigate = (folder?: string): void => {
		setQuery("");
		onLibraryChange((current) => ({ ...current, folder }));
	};

	const openFolderMenu = async (
		folder: RepositoryFolderGroup,
		event: EventPayload
	): Promise<void> => {
		if (!folder.path || !discovery) return;

		setMenuError(null);

		try {
			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.show(
				renderer,
				["Scan again", "Reveal in Finder", "Remove folder"],
				[true, !remote, true],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice === 0) discovery.rescan(folder.path);
			else if (choice === 1)
				await RepositoryFileActions.revealRepository(folder.path);
			else if (choice === 2) {
				discovery.removeFolder(folder.path);

				if (library.folder === folder.id) navigate();
			}
		} catch (cause) {
			setMenuError(
				cause instanceof Error
					? cause.message
					: "Could not perform folder action."
			);
		}
	};

	const openMenu = async (path: string, event: EventPayload) => {
		if (busy) return;

		setMenuError(null);

		try {
			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.show(
				renderer,
				[
					"Open",
					"Reveal in Finder",
					"Forget",
					starred.has(path) ? "Unstar" : "Star",
				],
				[true, !remote, true, true],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice === 0) onOpenRecent(path);
			else if (choice === 1) await RepositoryFileActions.revealRepository(path);
			else if (choice === 2) onForget(path);
			else if (choice === 3) onStar(path);
		} catch (cause) {
			setMenuError(
				cause instanceof Error
					? cause.message
					: "Could not perform repository action."
			);
		}
	};

	const scope = inFolder ? (selectedFolder?.paths ?? []) : paths;

	const matches = scope.filter((path) =>
		path.toLowerCase().includes(searchQuery)
	);

	const saved = new Set(savedPaths);
	const scanning = discovery?.status === "scanning" || discovery?.refreshing;

	return (
		<div testId="repository-welcome" style={styles.page}>
			{scanning ? (
				<RepositoryDiscoveryRail count={discovery.paths.length} />
			) : null}
			<div style={styles.columns}>
				<div
					style={{
						width: 220,
						flexShrink: 0,
						minHeight: 0,
						overflowY: "scroll",
					}}
				>
					{machines}
					<text style={styles.heading}>QUICK ACTIONS</text>
					{actions}
					<Button
						tokens={appTokens}
						variant="ghost"
						size="sm"
						testId="open-repository"
						disabled={busy}
						style={{ ...styles.action, marginTop: spacing[1] }}
						onPress={onOpen}
					>
						<svg
							source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
							style={{
								width: iconSize.lg,
								height: iconSize.lg,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						{busy ? "Opening…" : remote ? "Open folder" : "Open from disk"}
					</Button>
					{discovery?.available ? (
						<Button
							tokens={appTokens}
							variant="ghost"
							size="sm"
							testId="discovery-rescan"
							disabled={scanning}
							style={{ ...styles.action, marginTop: spacing[1] }}
							onPress={() => discovery.rescan()}
						>
							<WorkspaceTabIcon
								name="sync"
								testId="discovery-rescan-icon"
								size={iconSize.lg}
								color={appTokens.colors.textMuted}
							/>
							{scanning ? "Scanning…" : "Scan repositories"}
						</Button>
					) : null}
					{error ? (
						<text
							role="alert"
							style={{ ...styles.hint, marginTop: spacing[3] }}
						>
							{error}
						</text>
					) : null}
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						flexBasis: 0,
						minWidth: 0,
						minHeight: 0,
						gap: spacing[1],
					}}
				>
					<RepositoryLibrarySearch
						query={query}
						view={library.view}
						repositoryCount={scope.length}
						onBack={inFolder ? () => navigate() : undefined}
						trailingAction={
							inFolder && selectedFolder?.path ? (
								<Button
									ref={folderActions}
									testId="welcome-folder-actions"
									tokens={appTokens}
									variant="ghost"
									focusVisible={false}
									aria-label="Folder actions"
									style={{
										width: 40,
										height: 40,
										paddingLeft: 0,
										paddingRight: 0,
									}}
									onContextMenu={(event) => {
										void openFolderMenu(selectedFolder, event);
									}}
									onPress={() => {
										if (folderActions.current)
											void openFolderMenu(selectedFolder, {
												elementId: folderActions.current.id,
												eventType: "click",
											});
									}}
								>
									…
								</Button>
							) : null
						}
						onQueryChange={setQuery}
						onViewChange={(view) =>
							onLibraryChange((current) =>
								current.view === view ? current : { ...current, view }
							)
						}
					/>
					<div
						testId="welcome-results"
						role="tabpanel"
						aria-id="welcome-results"
						aria-label={
							library.view === "tiles" ? "Repository tiles" : "Repository list"
						}
						style={{
							display: "flex",
							flexDirection: "column",
							flexGrow: 1,
							flexBasis: 0,
							minHeight: 0,
							gap: spacing[1],
						}}
					>
						{discovery?.error ? (
							<text
								role="alert"
								style={{ ...styles.hint, color: appTokens.colors.danger }}
							>
								{discovery.error}
							</text>
						) : null}
						{menuError ? (
							<text role="alert" style={styles.hint}>
								{menuError}
							</text>
						) : null}
						{showFolders && (folders.length > 0 || (!!discovery && !remote)) ? (
							<div
								ref={libraryViewport}
								onScroll={() => {
									measureFavorites();
								}}
								testId="welcome-library"
								style={{ ...styles.list, gap: spacing[5] }}
							>
								<div
									testId="welcome-folders"
									style={{
										display: "flex",
										flexShrink: 0,
										flexDirection: library.view === "tiles" ? "row" : "column",
										flexWrap: library.view === "tiles" ? "wrap" : "nowrap",
										alignContent: "flex-start",
										gap: spacing[3],
									}}
								>
									{discovery && !remote ? (
										<RepositoryAddFolderTile
											layout={library.view}
											picking={discovery.picking}
											onAdd={() => {
												void discovery.chooseFolder();
											}}
										/>
									) : null}
									{folders.map((group) => (
										<RepositoryFolderTile
											key={group.id}
											group={group}
											layout={library.view}
											status={
												discovery?.folders.find(
													(folder) => folder.path === group.id
												)?.status
											}
											onOpen={() => navigate(group.id)}
											onMenu={(event) => {
												void openFolderMenu(group, event);
											}}
										/>
									))}
								</div>
								{favorites.length ? (
									<div
										testId="welcome-starred"
										role="group"
										aria-label="Starred repositories"
										style={{
											display: "flex",
											flexDirection: "column",
											gap: spacing[2],
											flexShrink: 0,
										}}
									>
										<text
											style={{
												...styles.heading,
												marginLeft: 0,
												marginBottom: 0,
											}}
										>
											STARRED REPOSITORIES
										</text>
										<div
											style={{
												display: "flex",
												flexDirection:
													library.view === "tiles" ? "row" : "column",
												flexWrap: library.view === "tiles" ? "wrap" : "nowrap",
												gap: spacing[3],
												alignContent: "flex-start",
											}}
										>
											{favorites.map((path) => (
												<RepositoryWelcomeRow
													key={path}
													layout={library.view}
													path={path}
													openRef={(button) => {
														if (button)
															favoriteButtons.current.set(path, button);
														else favoriteButtons.current.delete(path);
													}}
													busy={busy}
													starred
													onStar={onStar}
													onOpen={onOpenRecent}
													onForget={onForget}
													onMenu={openMenu}
												/>
											))}
										</div>
									</div>
								) : null}
							</div>
						) : matches.length > 0 ? (
							<RepositoryWelcomeList
								layout={library.view}
								key={`${library.view}:${library.folder}`}
								query={query}
								paths={matches}
								saved={saved}
								starred={starred}
								onStar={onStar}
								busy={busy}
								onOpen={onOpenRecent}
								onForget={onForget}
								onMenu={openMenu}
							/>
						) : (
							<div testId="welcome-repositories" style={styles.list}>
								<StateMessage
									artwork={query.trim() ? "search" : "repository"}
									title={
										query.trim()
											? "No repositories found"
											: unavailable
												? "Folder unavailable"
												: scanning
													? "Looking for repositories…"
													: "No repositories yet"
									}
									description={
										query.trim()
											? `No repositories match “${query.trim()}”.`
											: unavailable
												? "Reconnect this folder and choose Scan again. Your repositories have not been removed."
												: scanning
													? "You can open a repository while discovery runs in the background."
													: "Open a repository or scan another folder to find projects."
									}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
