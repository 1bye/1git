import { MachineLocation } from "../../machines/machine-location";
import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import {
	spacing,
	typography,
	fontWeight,
	iconSize,
	radius,
} from "@1git/design-tokens";
import {
	useMemo,
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
import { RepositoryFolderTile } from "./repository-folder-tile";

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

/** Launch page with machine selection, quick actions and a searchable repository library. */
export function RepositoryWelcome({
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
}: {
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
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { styles } = themedStyles.get(theme);

	const [query, setQuery] = useState("");
	const [menuError, setMenuError] = useState<string | null>(null);
	const renderer = useGpuixRequired();
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

	const inFolder = library.view === "listed" && !!library.folder;

	const showFolders =
		library.view === "listed" && !library.folder && !query.trim();

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

	const scope =
		library.view === "starred"
			? paths.filter((path) => starred.has(path))
			: inFolder
				? (selectedFolder?.paths ?? [])
				: paths;

	const matches = scope.filter((path) =>
		path.toLowerCase().includes(query.trim().toLowerCase())
	);

	const saved = new Set(savedPaths);
	const scanning = discovery?.status === "scanning";

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
					{remote ? null : (
						<>
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
								{busy ? "Opening…" : "Open from disk"}
							</Button>
						</>
					)}
					{discovery && !remote ? (
						<Button
							testId="discovery-folder"
							tokens={appTokens}
							variant="ghost"
							size="sm"
							disabled={discovery.picking}
							style={{
								...styles.action,
								marginTop: spacing[4],
							}}
							onPress={() => {
								void discovery.chooseFolder();
							}}
						>
							{discovery.picking ? "Choosing folder…" : "Add folder…"}
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
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
							minHeight: 30,
							marginBottom: spacing[2],
							gap: spacing[2],
						}}
					>
						<text
							style={{
								...styles.heading,
								marginBottom: 0,
								flexShrink: 1,
								whiteSpace: "nowrap",
								textOverflow: "ellipsis",
							}}
						>
							{library.view === "starred"
								? "STARRED"
								: inFolder
									? (selectedFolder?.name ?? "Other repositories")
									: "ALL REPOSITORIES"}
						</text>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								gap: spacing[1],
								flexShrink: 0,
							}}
						>
							{(["listed", "starred"] as const).map((view) => (
								<Button
									key={view}
									testId={`welcome-view-${view}`}
									tokens={appTokens}
									variant={library.view === view ? "secondary" : "ghost"}
									size="sm"
									aria-description={
										library.view === view ? "Selected view" : undefined
									}
									onPress={() => {
										setQuery("");
										onLibraryChange((current) => ({ ...current, view }));
									}}
								>
									{view === "listed" ? "Listed" : "Starred"}
								</Button>
							))}
						</div>
					</div>
					<input
						testId="welcome-search"
						aria-label="Search all repositories"
						placeholder="Search all repositories"
						value={query}
						tabIndex={0}
						onChange={(event) => setQuery(event.value ?? "")}
						style={{
							height: 34,
							flexShrink: 0,
							...typography.md,
							color: appTokens.colors.text,
							backgroundColor: "transparent",
							borderWidth: 1,
							borderColor: appTokens.colors.border,
							borderRadius: radius.md,
							paddingLeft: spacing[2.5],
							paddingRight: spacing[2.5],
							marginBottom: spacing[3],
						}}
					/>
					{discovery ? (
						<div
							testId="discovery-summary"
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[1],
								marginBottom: spacing[3],
							}}
						>
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									justifyContent: "space-between",
									gap: spacing[2],
								}}
							>
								<text
									style={{ ...styles.hint, ...typography.xs }}
								>{`${paths.length} ${paths.length === 1 ? "repository" : "repositories"}${scanning ? " · Scanning…" : ""}`}</text>
								<Button
									testId="discovery-rescan"
									tokens={appTokens}
									variant="ghost"
									size="sm"
									onPress={
										scanning
											? discovery.stop
											: () =>
													discovery.rescan(
														inFolder ? selectedFolder?.path : undefined
													)
									}
								>
									{scanning ? "Stop scanning" : "Scan again"}
								</Button>
							</div>
							{discovery.progress.limited || discovery.progress.skipped ? (
								<text
									testId="discovery-incomplete"
									style={{ ...styles.hint, ...typography.xs }}
								>
									{discovery.progress.limited
										? "Scan limit reached. Add a specific scan folder to find more."
										: `${discovery.progress.skipped} folders or repositories could not be inspected.`}
								</text>
							) : null}
							{discovery.error ? (
								<text
									role="alert"
									style={{
										...styles.hint,
										...typography.xs,
										color: appTokens.colors.danger,
									}}
								>
									{discovery.error}
								</text>
							) : null}
						</div>
					) : null}
					{inFolder ? (
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								minHeight: 30,
								marginBottom: spacing[2],
							}}
						>
							<Button
								testId="welcome-back"
								tokens={appTokens}
								variant="ghost"
								size="sm"
								onPress={() => navigate()}
							>
								← Folders
							</Button>
							<text
								style={{
									...styles.hint,
									...typography.xs,
									flexGrow: 1,
									minWidth: 0,
									flexShrink: 1,
									whiteSpace: "nowrap",
									textOverflow: "ellipsis",
								}}
							>
								{selectedFolder?.path
									? MachineLocation.display(selectedFolder.path)
									: "Other repositories"}
							</text>
							{selectedFolder?.path ? (
								<Button
									ref={folderActions}
									testId="welcome-folder-actions"
									tokens={appTokens}
									variant="ghost"
									size="sm"
									aria-label="Folder actions"
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
							) : null}
						</div>
					) : null}
					{menuError ? (
						<text role="alert" style={styles.hint}>
							{menuError}
						</text>
					) : null}
					{showFolders && folders.length ? (
						<div
							testId="welcome-folders"
							style={{
								...styles.list,
								flexDirection: "row",
								flexWrap: "wrap",
								alignContent: "flex-start",
								gap: spacing[3],
							}}
						>
							{folders.map((group) => (
								<RepositoryFolderTile
									key={group.id}
									group={group}
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
					) : matches.length > 0 &&
					  !showFolders &&
					  (discovery || matches.length > 200) ? (
						<RepositoryWelcomeList
							key={`${library.view}:${library.folder}:${query}`}
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
							{!showFolders
								? matches.map((path) => (
										<RepositoryWelcomeRow
											key={path}
											path={path}
											suggested={!saved.has(path)}
											starred={starred.has(path)}
											onStar={onStar}
											busy={busy}
											onOpen={onOpenRecent}
											onForget={onForget}
											onMenu={openMenu}
										/>
									))
								: null}
							{!matches.length || showFolders ? (
								<StateMessage
									artwork={query.trim() ? "search" : "repository"}
									title={
										library.view === "starred" && !query.trim()
											? "Nothing starred yet"
											: query.trim()
												? "No repositories found"
												: unavailable
													? "Folder unavailable"
													: scanning
														? "Looking for repositories…"
														: "No repositories yet"
									}
									description={
										library.view === "starred" && !query.trim()
											? "Star repositories to keep them together across folders."
											: query.trim()
												? `No repositories match “${query.trim()}”.`
												: unavailable
													? "Reconnect this folder and choose Scan again. Your repositories have not been removed."
													: scanning
														? "You can open a repository while discovery runs in the background."
														: "Open a repository or scan another folder to find projects."
									}
								/>
							) : null}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
