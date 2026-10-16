import { createThemedStyles, useAppTheme } from "../../../styles/theme";
import { typography, spacing, radius, iconSize } from "@1git/design-tokens";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button } from "@1git/gpuix-ui/button";

import { WorkspaceTabIcon } from "../../workspace-tabs/components/workspace-tab-icon";
import { accountProviderIcons } from "../../accounts/account-provider-icons";
import { AccountStore } from "../../accounts/lib/account-store";
import type { Accounts } from "../../accounts/lib/accounts";
import { cloneNavigation } from "../lib/repository-filter-shortcut";
import {
	RepositorySetup,
	type RepositorySetupRequest,
	type RepositorySetupResult,
} from "../lib/repository-setup";
import {
	RepositoryAccountPicker,
	type AccountCloneSelection,
} from "./repository-account-picker";
import { SetupProgress } from "./repository-setup";
import { StateArtwork } from "../../../fixture/state-artwork";
import { RepositoryAvatar } from "./repository-avatar";
import { MachineLocation } from "../../machines/machine-location";
import { RemoteFolderPicker } from "../../machines/remote-folder-picker";

const column = { display: "flex", flexDirection: "column" };
const row = { display: "flex", flexDirection: "row", alignItems: "center" };

const themedStyles = createThemedStyles(({ tokens: appTokens }) => {
	const hint = { ...typography.sm, color: appTokens.colors.textMuted };

	const input = {
		height: 32,
		...typography.md,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: appTokens.colors.border,
		color: appTokens.colors.text,
		backgroundColor: "transparent",
	};

	return { hint, input };
});

const sourceStyle = {
	width: "100%",
	justifyContent: "flex-start",
	gap: spacing[2],
};

function loadAccounts(accounts: Accounts) {
	try {
		return { saved: accounts.load(), error: undefined };
	} catch {
		return { saved: [], error: "Could not load accounts. Check Settings." };
	}
}

/** Public UI state stays mounted across Settings/tab switches; writes belong to the window lifecycle. */
export function RepositoryCloneView({
	accounts,
	active,
	disabled,
	onSubmit,
	onCancel,
	onOpen,
	onBack,
	onSettings,
	onAddAccount,
	preferredAccountKey,
	machine,
}: {
	accounts: Accounts;
	active: boolean;
	disabled: boolean;
	onSubmit: (request: RepositorySetupRequest) => Promise<RepositorySetupResult>;
	onCancel: () => void;
	onOpen: (path: string) => void;
	onBack: () => void;
	onSettings: () => void;
	onAddAccount: () => void;
	/** Window-local default; changing it never overwrites an existing Clone draft. */
	preferredAccountKey?: string;
	/** Home pins the selected saved machine for the lifetime of this Clone draft. */
	machine?: { id: string; name: string; home: string };
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const { hint, input } = themedStyles.get(theme);

	const renderer = useGpuixRequired();
	const [catalog, setCatalog] = useState(() => loadAccounts(accounts));

	const [source, setSource] = useState(() => {
		const account =
			catalog.saved.find(
				(item) => AccountStore.key(item) === preferredAccountKey
			) ?? catalog.saved[0];

		return account ? AccountStore.key(account) : "url";
	});

	const [url, setUrl] = useState("");
	const [selection, setSelection] = useState<AccountCloneSelection>();
	const [selectedPath, setSelectedPath] = useState<string>();
	const [picking, setPicking] = useState(false);
	const [browsing, setBrowsing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState<string>();
	const [openPath, setOpenPath] = useState<string>();
	const working = useRef(false);
	const mounted = useRef(true);
	const searchField = useRef<PublicInstance | null>(null);

	const account = catalog.saved.find(
		(item) => AccountStore.key(item) === source
	);

	const remoteUrl =
		source === "url"
			? url.trim()
			: ((machine
					? (selection?.repository.cloneUrls.ssh ??
						selection?.repository.cloneUrls.https)
					: selection?.repository.cloneUrls.https) ?? "");

	const path =
		selectedPath ??
		(remoteUrl
			? join(machine?.home ?? homedir(), RepositorySetup.folderName(remoteUrl))
			: "");

	const destinationValid =
		!machine ||
		(isAbsolute(path) &&
			!MachineLocation.isRemote(path) &&
			!/[\0\r\n]/.test(path));

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (!active) return;

		const current = loadAccounts(accounts);

		setCatalog(current);
		setSource((previous) =>
			previous === "url" ||
			current.saved.some((item) => AccountStore.key(item) === previous)
				? previous
				: "url"
		);
		setSelection((previous) =>
			previous &&
			current.saved.some(
				(item) => AccountStore.key(item) === AccountStore.key(previous.account)
			)
				? previous
				: undefined
		);
	}, [accounts, active]);

	const back = useCallback(() => {
		if (!working.current && !picking) onBack();
	}, [onBack, picking]);

	useEffect(() => {
		if (!active) return;

		cloneNavigation.set(renderer, {
			back,
			search: () => {
				const field = searchField.current;

				if (field) renderer.focusElement?.(field.id);
			},
		});

		return () => {
			cloneNavigation.delete(renderer);
		};
	}, [active, renderer, back]);

	const clearError = () => {
		setError(undefined);
		setOpenPath(undefined);
	};

	const changeSource = (value: string) => {
		if (working.current || picking) return;

		setSource(value);
		setSelection(undefined);
		clearError();
	};

	const chooseLocation = async () => {
		if (working.current || picking) return;

		setPicking(true);

		try {
			if (!renderer.promptForPaths)
				throw new Error("Folder selection is unavailable.");

			const paths = await renderer.promptForPaths({
				directories: true,
				files: false,
				multiple: false,
				prompt: "Choose empty clone folder",
			});

			if (mounted.current && paths?.[0]) {
				setSelectedPath(paths[0]);
				clearError();
			}
		} catch {
			if (mounted.current) setError("Could not open the folder picker.");
		} finally {
			if (mounted.current) setPicking(false);
		}
	};

	const submit = async () => {
		if (
			working.current ||
			disabled ||
			picking ||
			!path ||
			!remoteUrl ||
			!destinationValid
		)
			return;

		if (openPath) {
			onOpen(openPath);
			onBack();

			return;
		}

		working.current = true;
		setBusy(true);
		setStopping(false);
		clearError();

		try {
			const result = await onSubmit({
				kind: "clone",
				path: machine ? MachineLocation.encode(machine.id, path) : path,
				remoteUrl,
				...(account && selection && !machine
					? { source: { account, repository: selection.repository.ref } }
					: {}),
			});

			if (!mounted.current) return;

			if (result.ok) onBack();
			else {
				setError(result.message);
				setOpenPath(result.openPath);
			}
		} catch {
			if (mounted.current)
				setError(
					"Clone did not finish. Review the destination before retrying."
				);
		} finally {
			working.current = false;

			if (mounted.current) {
				setBusy(false);
				setStopping(false);
			}
		}
	};

	return (
		<div
			testId="repository-clone-view"
			aria-hidden={!active || undefined}
			style={{
				...row,
				alignItems: "stretch",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
				...(!active
					? {
							position: "absolute",
							width: "100%",
							height: "100%",
							visibility: "hidden",
							pointerEvents: "none",
						}
					: {}),
			}}
		>
			{browsing && machine ? (
				<RemoteFolderPicker
					location={MachineLocation.encode(
						machine.id,
						path && destinationValid ? dirname(path) : machine.home
					)}
					title="Choose clone folder"
					initialName={path && destinationValid ? basename(path) : ""}
					onSelect={(location) => {
						setSelectedPath(MachineLocation.display(location));
						clearError();
						setBrowsing(false);
						setPicking(false);
					}}
					onClose={() => {
						setBrowsing(false);
						setPicking(false);
					}}
				/>
			) : null}
			<div
				role="navigation"
				aria-label="Clone sources"
				style={{
					...column,
					width: 200,
					flexShrink: 0,
					padding: spacing[3],
					gap: spacing[1],
					borderRightWidth: 1,
					borderColor: appTokens.colors.border,
				}}
			>
				<Button
					testId="clone-back"
					tokens={appTokens}
					variant="ghost"
					size="sm"
					disabled={busy || picking}
					style={sourceStyle}
					onPress={back}
				>
					<WorkspaceTabIcon name="arrowLeft" />
					Back
				</Button>
				<text
					style={{
						...hint,
						...typography.xs,
						marginTop: spacing[4],
						marginBottom: spacing[1.5],
						marginLeft: spacing[2],
					}}
				>
					SOURCES
				</text>
				<div
					style={{
						...column,
						gap: spacing[1],
						minHeight: 0,
						flexShrink: 1,
						overflowY: "scroll",
					}}
				>
					{catalog.saved.map((item) => (
						<Button
							key={AccountStore.key(item)}
							testId={`clone-account-${item.id}`}
							tokens={appTokens}
							size="sm"
							variant={
								source === AccountStore.key(item) ? "secondary" : "ghost"
							}
							aria-label={`${item.username} · ${new URL(item.webUrl).host}`}
							aria-pressed={source === AccountStore.key(item)}
							disabled={busy || picking}
							onPress={() => changeSource(AccountStore.key(item))}
							style={{ ...sourceStyle, height: 46 }}
						>
							<svg
								source={accountProviderIcons[item.provider]}
								style={{
									width: iconSize.md,
									height: iconSize.md,
									flexShrink: 0,
									color: appTokens.colors.textMuted,
									pointerEvents: "none",
								}}
							/>
							<div
								style={{
									...column,
									gap: spacing[0.5],
									minWidth: 0,
									flexShrink: 1,
									flexGrow: 1,
									pointerEvents: "none",
								}}
							>
								<text
									style={{
										...typography.md,
										color: appTokens.colors.text,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{item.username}
								</text>
								<text
									style={{
										...hint,
										whiteSpace: "nowrap",
										textOverflow: "ellipsis",
									}}
								>
									{new URL(item.webUrl).host}
								</text>
							</div>
						</Button>
					))}
				</div>
				<Button
					testId="clone-source-url"
					tokens={appTokens}
					variant={source === "url" ? "secondary" : "ghost"}
					size="sm"
					disabled={busy || picking}
					style={sourceStyle}
					onPress={() => changeSource("url")}
				>
					<WorkspaceTabIcon name="branch" />
					Repository URL
				</Button>
				<Button
					testId="clone-settings"
					tokens={appTokens}
					variant="ghost"
					size="sm"
					disabled={busy || picking}
					style={{ ...sourceStyle, marginTop: spacing[3] }}
					onPress={onAddAccount}
				>
					<WorkspaceTabIcon name="add" />
					Add account
				</Button>
			</div>
			<div style={{ ...column, flexGrow: 1, minWidth: 0, minHeight: 0 }}>
				<div
					style={{
						...column,
						flexGrow: 1,
						minHeight: 0,
						minWidth: 0,
						padding: spacing[6],
						gap: spacing[4.5],
					}}
				>
					<text
						style={{
							...typography.xl,
							color: appTokens.colors.text,
							flexShrink: 0,
						}}
					>
						{machine ? `Clone on ${machine.name}` : "Clone repository"}
					</text>
					<div
						style={{
							...column,
							flexGrow: 1,
							minHeight: 0,
							width: "100%",
							maxWidth: 760,
						}}
					>
						{busy ? (
							<div
								style={{
									...column,
									gap: spacing[3],
									flexGrow: 1,
									justifyContent: "center",
									alignItems: "center",
								}}
							>
								<StateArtwork name="clone" />
								<text
									testId="setup-progress"
									role="status"
									style={{ ...typography.md, color: appTokens.colors.text }}
								>
									{stopping ? "Stopping…" : "Cloning repository…"}
								</text>
								<text style={hint}>
									{selection
										? `${selection.repository.ref.owner}/${selection.repository.ref.name}`
										: RepositorySetup.folderName(remoteUrl)}
								</text>
								<div style={{ width: "100%", maxWidth: 420 }}>
									<SetupProgress />
								</div>
							</div>
						) : source === "url" ? (
							<div style={{ ...column, gap: spacing[1.5] }}>
								<text style={hint}>Repository URL</text>
								<div style={{ ...row, gap: spacing[2.5] }}>
									<RepositoryAvatar
										label={
											RepositorySetup.folderName(remoteUrl) || "Repository"
										}
										source={url.trim() ? { remote: url.trim() } : undefined}
										testId="clone-url-avatar"
									/>
									<input
										ref={searchField}
										testId="setup-url"
										autoFocus={active}
										tabIndex={0}
										aria-label="Repository URL"
										value={url}
										placeholder="https://github.com/owner/project.git"
										style={{ ...input, flexGrow: 1, minWidth: 0 }}
										onChange={(event) => {
											setUrl(event.value ?? "");
											clearError();
										}}
									/>
								</div>
								<text style={{ ...hint, marginTop: spacing[1] }}>
									{machine
										? `Uses Git credentials configured on ${machine.name}.`
										: "Clone using your configured Git credentials."}
								</text>
							</div>
						) : account && active ? (
							<RepositoryAccountPicker
								key={source}
								accounts={accounts}
								account={account}
								searchRef={searchField}
								selection={selection}
								onSelect={(value) => {
									setSelection(value);
									clearError();
								}}
								onSettings={onSettings}
							/>
						) : null}
					</div>
				</div>
				<div
					testId="clone-footer"
					style={{
						...column,
						gap: spacing[2.5],
						padding: spacing[4],
						paddingLeft: spacing[6],
						paddingRight: spacing[6],
						flexShrink: 0,
						borderTopWidth: 1,
						borderColor: appTokens.colors.border,
					}}
				>
					{error || catalog.error || (path && !destinationValid) ? (
						<text
							testId="setup-error"
							role="alert"
							style={{ ...hint, color: appTokens.colors.danger }}
						>
							{error ??
								catalog.error ??
								"Enter an absolute folder path on this machine."}
						</text>
					) : null}
					<div
						style={{ ...row, gap: spacing[3], width: "100%", maxWidth: 760 }}
					>
						<div
							style={{ ...column, flexGrow: 1, minWidth: 0, gap: spacing[1] }}
						>
							<text style={hint}>
								{machine ? `Location on ${machine.name}` : "Location"}
							</text>
							{machine ? (
								<div style={{ ...row, gap: spacing[2] }}>
									<input
										testId="setup-remote-location"
										aria-label={`Clone folder on ${machine.name}`}
										tabIndex={busy ? undefined : 0}
										value={path}
										readOnly={busy}
										placeholder={`${machine.home}/project`}
										style={{
											...input,
											flexGrow: 1,
											flexBasis: 0,
											...(busy ? { pointerEvents: "none", opacity: 0.5 } : {}),
										}}
										onChange={(event) => {
											if (working.current) return;

											setSelectedPath(event.value ?? "");
											clearError();
										}}
									/>
									<Button
										tokens={appTokens}
										variant="secondary"
										size="sm"
										testId="clone-browse-remote"
										disabled={busy || picking}
										onPress={() => {
											setPicking(true);
											setBrowsing(true);
										}}
									>
										Browse…
									</Button>
								</div>
							) : (
								<Button
									testId="setup-location"
									tokens={appTokens}
									variant="ghost"
									size="sm"
									aria-label={path || "Choose repository folder"}
									disabled={busy || picking}
									onPress={() => {
										void chooseLocation();
									}}
									style={{
										...input,
										...row,
										justifyContent: "flex-start",
										gap: spacing[2],
										hover: { backgroundColor: "transparent" },
									}}
								>
									<svg
										source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
										style={{
											width: iconSize.sm,
											height: iconSize.sm,
											flexShrink: 0,
											color: appTokens.colors.textMuted,
											pointerEvents: "none",
										}}
									/>
									<text
										style={{
											...typography.md,
											color: appTokens.colors.text,
											minWidth: 0,
											flexShrink: 1,
											whiteSpace: "nowrap",
											textOverflow: "ellipsis",
											pointerEvents: "none",
										}}
									>
										{picking ? "Choosing…" : path || "Choose folder…"}
									</text>
								</Button>
							)}
						</div>
						<Button
							testId="setup-cancel"
							tokens={appTokens}
							variant="secondary"
							size="sm"
							disabled={picking || stopping}
							style={{ alignSelf: "flex-end" }}
							onPress={() => {
								if (working.current) {
									setStopping(true);
									onCancel();
								} else back();
							}}
						>
							{stopping ? "Stopping…" : "Cancel"}
						</Button>
						<Button
							testId="setup-submit"
							tokens={appTokens}
							size="sm"
							style={{ alignSelf: "flex-end" }}
							disabled={
								busy ||
								disabled ||
								picking ||
								!path ||
								!remoteUrl ||
								!destinationValid
							}
							onPress={() => {
								void submit();
							}}
						>
							{busy
								? "Cloning…"
								: openPath
									? "Open repository"
									: error
										? "Retry"
										: "Clone"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
