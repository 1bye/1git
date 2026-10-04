import { basename } from "node:path";
import { useState, type ReactNode } from "react";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type EventPayload } from "@gpuix/react";
import { NativeFileMenu } from "../lib/native-file-menu";
import { RepositoryFileActions } from "../lib/repository-file-actions";
import { appTokens } from "../../../styles/tokens";
import { StateMessage } from "../../../fixture/state-message";

const styles = StyleSheet.create({
	page: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		minHeight: 0,
		overflowY: "scroll",
		padding: 40,
		alignItems: "center",
	},
	columns: {
		display: "flex",
		flexDirection: "row",
		alignItems: "flex-start",
		width: "100%",
		maxWidth: 980,
		gap: 64,
	},
	heading: {
		fontSize: 10,
		fontWeight: 500,
		color: appTokens.colors.textMuted,
		marginBottom: 12,
		marginLeft: 10,
	},
	hint: { fontSize: 11, color: appTokens.colors.textMuted },
	action: {
		width: "100%",
		justifyContent: "flex-start",
		gap: 8,
		color: appTokens.colors.textMuted,
	},
});

/** Desktop-style launch page: quick actions beside a local, searchable repository list. */
export function RepositoryWelcome({
	paths,
	actions,
	busy,
	error,
	onOpen,
	onOpenRecent,
	onForget,
}: {
	paths: readonly string[];
	actions: ReactNode;
	busy: boolean;
	error?: string | null;
	onOpen: () => void;
	onOpenRecent: (path: string) => void;
	onForget: (path: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [menuError, setMenuError] = useState<string | null>(null);
	const renderer = useGpuixRequired();

	const openMenu = async (path: string, event: EventPayload) => {
		if (busy) return;

		setMenuError(null);

		try {
			const bounds = renderer.getElementBounds?.(event.elementId);

			const choice = NativeFileMenu.show(
				renderer,
				["Open", "Reveal in Finder", "Forget"],
				[true, true, true],
				event.x ?? bounds?.x ?? 0,
				event.y ?? (bounds ? bounds.y + bounds.height : 0)
			);

			if (choice === 0) onOpenRecent(path);
			else if (choice === 1) await RepositoryFileActions.revealRepository(path);
			else if (choice === 2) onForget(path);
		} catch (cause) {
			setMenuError(
				cause instanceof Error
					? cause.message
					: "Could not perform repository action."
			);
		}
	};

	const matches = paths.filter((path) =>
		path.toLowerCase().includes(query.trim().toLowerCase())
	);

	return (
		<div testId="repository-welcome" style={styles.page}>
			<div style={styles.columns}>
				<div style={{ width: 220, flexShrink: 0 }}>
					<text style={styles.heading}>QUICK ACTIONS</text>
					{actions}
					<Button
						tokens={appTokens}
						variant="ghost"
						size="sm"
						testId="open-repository"
						disabled={busy}
						style={{ ...styles.action, marginTop: 4 }}
						onPress={onOpen}
					>
						<svg
							source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
							style={{
								width: 14,
								height: 14,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						{busy ? "Opening…" : "Open from disk"}
					</Button>
					{error ? (
						<text role="alert" style={{ ...styles.hint, marginTop: 12 }}>
							{error}
						</text>
					) : null}
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						minWidth: 0,
						gap: 4,
					}}
				>
					<text style={styles.heading}>ALL REPOSITORIES</text>
					<input
						testId="welcome-search"
						aria-label="Search all repositories"
						placeholder="Search all repositories"
						value={query}
						tabIndex={0}
						onChange={(event) => setQuery(event.value ?? "")}
						style={{
							height: 34,
							fontSize: 12,
							color: appTokens.colors.text,
							backgroundColor: "transparent",
							borderWidth: 1,
							borderColor: appTokens.colors.border,
							borderRadius: 6,
							paddingLeft: 10,
							paddingRight: 10,
							marginBottom: 12,
						}}
					/>
					{matches.map((path) => (
						<Button
							key={path}
							tokens={appTokens}
							variant="ghost"
							testId={`welcome-repository-${path}`}
							aria-label={`Open ${path}`}
							disabled={busy}
							onPress={() => onOpenRecent(path)}
							onContextMenu={(event) => {
								void openMenu(path, event);
							}}
							style={{
								height: 54,
								width: "100%",
								justifyContent: "flex-start",
								paddingLeft: 12,
							}}
						>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 3,
									minWidth: 0,
									flexGrow: 1,
									pointerEvents: "none",
								}}
							>
								<text style={{ fontSize: 12, color: appTokens.colors.text }}>
									{basename(path)}
								</text>
								<text
									style={{
										...styles.hint,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{path}
								</text>
							</div>
						</Button>
					))}
					{menuError ? (
						<text role="alert" style={styles.hint}>
							{menuError}
						</text>
					) : null}
					{!matches.length ? (
						<StateMessage
							artwork={query.trim() ? "search" : "repository"}
							title={
								query.trim() ? "No repositories found" : "No repositories yet"
							}
							description={
								query.trim()
									? `No repositories match “${query.trim()}”.`
									: "Repositories you open, clone, or create will appear here."
							}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}
