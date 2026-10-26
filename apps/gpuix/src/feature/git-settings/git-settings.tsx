import { createThemedStyles, useAppTheme } from "../../styles/theme";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { spacing, radius } from "@1git/design-tokens";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";

import {
	SettingsPage,
	SettingsSection,
	SettingsPanel,
	SettingsSplit,
	settingsStyles,
} from "../settings/settings-layout";
import { SettingsGroup, SettingsGroupRow } from "../settings/settings-group";
import { accountActionIcons } from "../accounts/account-list";
import { StateArtwork } from "../../fixture/state-artwork";
import { ChoiceTile } from "../../fixture/choice-tile";
import { AccountStore, type SavedAccount } from "../accounts/lib/account-store";
import { accountProviderIcons } from "../accounts/account-provider-icons";
import type { CommitIdentity } from "@1git/hosting/contracts";
import type { RemoteAccounts } from "../accounts/lib/remote-accounts";
import { RemoteAccount, RemoteProviderIcon } from "./remote-account";
import {
	GitSettingsModel,
	type GitSettingsData,
	type GitSettingsRequest,
} from "./git-settings-model";
import type { GitResult } from "@1git/git";

const column = {
	display: "flex",
	flexDirection: "column",
	gap: spacing[2],
	flexShrink: 0,
};

const row = {
	display: "flex",
	flexDirection: "row",
	alignItems: "center",
	gap: spacing[2],
	flexShrink: 0,
};

const themedStyles = createThemedStyles((theme) => {
	const { tokens: appTokens } = theme;
	const styles = settingsStyles.get(theme);

	const field = {
		height: appTokens.layout.controlHeight,
		...styles.label,
		backgroundColor: "transparent",
		borderWidth: 1,
		borderColor: appTokens.colors.border,
		borderRadius: radius.md,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
	};

	return { field };
});

function SettingsField({
	ref,
	id,
	label,
	value,
	disabled,
	onChange,
}: {
	ref?: Ref<PublicInstance>;
	id: string;
	label: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const theme = useAppTheme();
	const { field } = themedStyles.get(theme);
	const styles = settingsStyles.get(theme);

	return (
		<div style={column}>
			<text style={styles.label}>{label}</text>
			<input
				ref={ref}
				testId={id}
				aria-label={label}
				value={value}
				readOnly={disabled}
				aria-disabled={disabled}
				tabIndex={disabled ? undefined : 0}
				style={{ ...field, opacity: disabled ? 0.5 : 1 }}
				onChange={(event) => {
					if (!disabled) onChange(event.value ?? "");
				}}
			/>
		</div>
	);
}

/** Lets Settings dismiss an open editor before leaving the page. */
export interface GitSettingsHandle {
	cancelEditor: () => boolean;
}

/** Author settings and explicit remote editors; loading a pane never writes to Git. */
export function GitSettings({
	ref,
	root,
	page = "identity",
	disabled = false,
	read = GitSettingsModel.read,
	write = GitSettingsModel.write,
	autoIncludeChanges = false,
	onAutoIncludeChanges,
	accounts = [],
	remoteAccounts,
	readAccountIdentity,
	onBusy,
}: {
	ref?: Ref<GitSettingsHandle>;
	root: string | null;
	page?: "identity" | "remotes";
	disabled?: boolean;
	read?: typeof GitSettingsModel.read;
	accounts?: readonly SavedAccount[];
	remoteAccounts?: RemoteAccounts;
	readAccountIdentity?: (
		account: SavedAccount,
		signal: AbortSignal
	) => Promise<CommitIdentity>;
	write?: (
		root: string | null,
		request: GitSettingsRequest
	) => Promise<GitResult<GitSettingsData>>;
	autoIncludeChanges?: boolean;
	onAutoIncludeChanges?: (enabled: boolean) => void;
	onBusy: (busy: boolean) => void;
}) {
	const theme = useAppTheme();
	const { tokens: appTokens } = theme;
	const styles = settingsStyles.get(theme);
	const muted = styles.description;

	const renderer = useGpuixRequired();
	const [data, setData] = useState<GitSettingsData | null>(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [custom, setCustom] = useState(false);
	const [identitySource, setIdentitySource] = useState("custom");
	const [loadingIdentity, setLoadingIdentity] = useState(false);
	const identityRequest = useRef<AbortController | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const [editing, setEditing] = useState<
		"identity" | "add" | "edit" | "account" | null
	>(null);

	const [remoteName, setRemoteName] = useState("");
	const [remoteUrl, setRemoteUrl] = useState("");

	const [remoteChoices, setRemoteChoices] = useState<Record<string, string>>(
		{}
	);

	const [accountRevision, setAccountRevision] = useState(0);
	const [removing, setRemoving] = useState<string | null>(null);
	const pending = useRef(false);
	const mounted = useRef(true);
	const editor = useRef<PublicInstance | null>(null);
	const remoteUrlField = useRef<PublicInstance | null>(null);
	const returnFocus = useRef<number | null>(null);
	const locked = disabled || busy || !data;
	const commonDirectory = data?.commonDirectory;
	const identityLocked = locked || !!data?.identityReadOnlyReason;

	const editedRemote = data?.remotes.find(
		(remote) => remote.name === remoteName
	);

	const accountUrls = [
		...new Set(
			editing === "account"
				? [
						...(editedRemote?.fetchUrls ?? []),
						...(editedRemote?.pushUrls ?? []),
					]
				: [
						remoteUrl.trim(),
						...(editedRemote &&
						editedRemote.pushUrls.join() !== editedRemote.fetchUrls.join()
							? editedRemote.pushUrls
							: []),
					]
		),
	].filter((url) => url.startsWith("https://"));

	const apply = useCallback(
		(next: GitSettingsData): void => {
			setData(next);
			setName(next.identity.name ?? "");
			setEmail(next.identity.email ?? "");
			setCustom(next.custom);
			setIdentitySource(root && !next.custom ? "default" : "custom");
		},
		[root]
	);

	const stopIdentityRequest = useCallback(() => {
		identityRequest.current?.abort();
		identityRequest.current = null;
		setLoadingIdentity(false);
	}, []);

	const cancelEditor = useCallback((): boolean => {
		if (!editing) return false;

		if (pending.current) return true;

		stopIdentityRequest();

		if (data) apply(data);

		setEditing(null);
		setError(null);

		return true;
	}, [editing, data, apply, stopIdentityRequest]);

	useImperativeHandle(ref, () => ({ cancelEditor }), [cancelEditor]);

	useEffect(() => {
		const focus = setTimeout(() => {
			if (editing === "edit" && remoteUrlField.current)
				renderer.focusElement?.(remoteUrlField.current.id);
			else if (editing && editor.current)
				renderer.focusNextWithin?.(editor.current.id);
			else if (!editing && returnFocus.current !== null) {
				renderer.focusElement?.(returnFocus.current);
				returnFocus.current = null;
			}
		}, 0);

		return () => clearTimeout(focus);
	}, [editing, renderer]);

	useEffect(() => {
		mounted.current = true;
		stopIdentityRequest();
		setData(null);
		setError(null);
		setEditing(null);
		const controller = new AbortController();

		void (async () => {
			try {
				const result = await read(root, controller.signal);

				if (controller.signal.aborted) return;

				if (result.ok) apply(result.value);
				else setError(result.error.message);
			} catch {
				if (!controller.signal.aborted)
					setError("Could not read Git settings. Reopen settings to retry.");
			}
		})();

		return () => {
			mounted.current = false;
			controller.abort();
			identityRequest.current?.abort();
		};
	}, [root, read, apply, stopIdentityRequest]);

	const chooseAccount = async (account: SavedAccount): Promise<void> => {
		if (identityLocked || !readAccountIdentity) return;

		stopIdentityRequest();
		const controller = new AbortController();

		identityRequest.current = controller;
		setIdentitySource(AccountStore.key(account));
		setCustom(true);
		setName(account.username);
		setEmail("");
		setError(null);
		setLoadingIdentity(true);

		try {
			const identity = await readAccountIdentity(account, controller.signal);

			if (controller.signal.aborted || !mounted.current) return;

			setName(identity.name ?? account.username);
			setEmail(identity.email ?? "");
		} catch {
			if (!controller.signal.aborted && mounted.current)
				setError(
					"Could not read the account identity. Enter it manually or select the account to retry."
				);
		} finally {
			if (identityRequest.current === controller) {
				identityRequest.current = null;

				if (mounted.current) setLoadingIdentity(false);
			}
		}
	};

	const save = async (request: GitSettingsRequest): Promise<void> => {
		if (locked || pending.current) return;

		if (request.kind === "identity" && loadingIdentity) return;

		pending.current = true;
		setBusy(true);
		onBusy(true);
		setError(null);
		setStatus(null);

		try {
			const accountOnly =
				request.kind === "edit-remote" &&
				(editing === "account" ||
					editedRemote?.fetchUrls[0] === request.url.trim());

			const result = accountOnly
				? await read(root, new AbortController().signal)
				: await write(root, request);

			if (!mounted.current) return;

			if (result.ok) {
				apply(result.value);

				if (request.kind === "add-remote" || request.kind === "edit-remote") {
					const savedRemote = result.value.remotes.find(
						(remote) => remote.name === request.name.trim()
					);

					const urls = new Set([
						...(savedRemote?.fetchUrls ?? []),
						...(savedRemote?.pushUrls ?? []),
					]);

					try {
						if (
							Object.keys(remoteChoices).length &&
							(!result.value.commonDirectory ||
								result.value.commonDirectory !== commonDirectory)
						)
							throw new Error("The repository changed.");

						for (const [url, choice] of Object.entries(remoteChoices)) {
							if (accountOnly && accountUrls.includes(url) && !urls.has(url))
								throw new Error("The remote destination changed.");

							if (
								urls.has(url) &&
								accountUrls.includes(url) &&
								remoteAccounts &&
								result.value.commonDirectory
							)
								remoteAccounts.select(
									result.value.commonDirectory,
									request.name.trim(),
									url,
									choice
								);
						}
					} catch {
						setError(
							"Could not save the account choice. Review the saved remote and choose an account before syncing."
						);

						return;
					} finally {
						setAccountRevision((previous) => previous + 1);
					}
				}

				setEditing(null);
				setRemoving(null);
				setStatus(
					request.kind === "identity"
						? "Identity saved."
						: accountOnly
							? "Account saved."
							: "Remote settings saved."
				);
			} else {
				setError(
					`${result.error.message} Check the saved settings before retrying.`
				);
				// A multi-key config save can fail partway through. Show what Git actually saved.
				const fresh = await read(root, new AbortController().signal);

				if (mounted.current) {
					if (fresh.ok) apply(fresh.value);
					else setData(null);
				}
			}
		} catch {
			if (mounted.current) {
				setData(null);
				setError(
					"Could not confirm the save. Reopen settings to read the current configuration before retrying."
				);
			}
		} finally {
			pending.current = false;
			onBusy(false);

			if (mounted.current) setBusy(false);
		}
	};

	const identityChanged =
		!!data &&
		(custom !== data.custom ||
			(custom &&
				(name !== (data.identity.name ?? "") ||
					email !== (data.identity.email ?? ""))));

	const choices = [
		...(root
			? [
					{
						key: "default",
						label: "Default",
						source: accountActionIcons.check,
						detail: "Computer-wide identity",
						account: null,
					},
				]
			: []),
		...accounts.map((account) => ({
			key: AccountStore.key(account),
			label: account.username,
			source: accountProviderIcons[account.provider],
			detail: new URL(account.webUrl).host,
			account,
		})),
		{
			key: "custom",
			label: "Custom",
			source: accountActionIcons.reconnect,
			detail: "Enter name and email",
			account: null,
		},
	];

	return (
		<SettingsSplit
			testId={root ? "repository-settings" : "git-settings"}
			list={
				<SettingsPage
					testId="git-settings-page"
					scrollTestId="git-settings-scroll"
					title={
						page === "remotes" ? "Remotes" : root ? "Commit identity" : "Git"
					}
					titleTestId="git-settings-heading"
					action={
						<div style={row}>
							{root && page === "remotes" && data ? (
								<Button
									testId="remote-add"
									tokens={appTokens}
									variant="secondary"
									size="sm"
									disabled={locked || editing !== null}
									onPress={() => {
										returnFocus.current =
											renderer.getFocusedElementId?.() ?? null;
										setRemoteName("");
										setRemoteUrl("");
										setRemoteChoices({});
										setEditing("add");
										setError(null);
										setStatus(null);
									}}
								>
									Add remote
								</Button>
							) : null}
						</div>
					}
				>
					<SettingsSection>
						{!root && page === "identity" ? (
							<SettingsGroup title="Committing">
								<SettingsGroupRow
									label="Automatically include changed files"
									description="Include all changed files in your next commit automatically."
									trailing={
										<Checkbox
											testId="git-auto-include-changes"
											aria-label="Automatically include changed files"
											checked={autoIncludeChanges}
											onCheckedChange={(enabled) =>
												onAutoIncludeChanges?.(enabled)
											}
											disabled={disabled || !onAutoIncludeChanges}
											tokens={appTokens}
										/>
									}
								/>
							</SettingsGroup>
						) : null}
						{!data && !error ? (
							<div style={column}>
								<StateArtwork name="loading" compact />
								<text style={muted}>Reading Git settings…</text>
							</div>
						) : null}
						{!data && error ? <StateArtwork name="error" compact /> : null}
						{data ? (
							<>
								{page === "identity" ? (
									<SettingsGroup
										testId="identity-summary"
										title="Identity"
										footer={data.identityReadOnlyReason || undefined}
									>
										<SettingsGroupRow
											leading={
												<div
													aria-hidden
													style={{
														width: 32,
														height: 32,
														flexShrink: 0,
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														borderRadius: radius.full,
														backgroundColor: appTokens.colors.surface,
													}}
												>
													<text style={styles.sectionTitle}>
														{data.identity.name
															?.trim()
															.split(/\s+/u)
															.slice(0, 2)
															.map((part) => Array.from(part)[0])
															.join("")
															.toUpperCase() || "?"}
													</text>
												</div>
											}
											label={data.identity.name || "Name not configured"}
											description={
												data.identity.email || "Email not configured"
											}
											badge={
												root && !data.custom ? "Default identity" : undefined
											}
											trailing={
												<Button
													testId="identity-edit"
													tokens={appTokens}
													variant="secondary"
													size="sm"
													disabled={identityLocked || editing !== null}
													onPress={() => {
														returnFocus.current =
															renderer.getFocusedElementId?.() ?? null;
														apply(data);
														setEditing("identity");
														setError(null);
														setStatus(null);
													}}
												>
													Edit
												</Button>
											}
										/>
									</SettingsGroup>
								) : null}
								{root && page === "remotes" ? (
									<SettingsGroup
										testId="remotes-list"
										title="Remotes"
										meta={`${data.remotes.length} ${data.remotes.length === 1 ? "remote" : "remotes"}`}
									>
										{!data.remotes.length ? (
											<div
												testId="remotes-empty"
												style={{
													...column,
													alignItems: "center",
													padding: spacing[4],
												}}
											>
												<StateArtwork name="repository" />
												<text style={muted}>No remotes configured.</text>
											</div>
										) : null}
										{data.remotes.map((remote) => (
											<SettingsGroupRow
												key={remote.name}
												testId={`remote-${remote.name}`}
												leading={
													<RemoteProviderIcon
														testId={`remote-provider-${remote.name}`}
														url={remote.fetchUrls[0] ?? ""}
														accounts={accounts}
													/>
												}
												label={
													<div
														style={{
															...column,

															flexShrink: 1,
															minWidth: 0,
															gap: spacing[1],
														}}
													>
														<text
															style={{
																...styles.label,
															}}
														>
															{remote.name}
														</text>
														<text
															style={{
																...muted,
																overflowX: "hidden",
																textOverflow: "ellipsis",
															}}
														>
															{remote.fetchUrls.join(", ")}
														</text>
														{remote.pushUrls.join() !==
														remote.fetchUrls.join() ? (
															<text
																style={muted}
															>{`Push: ${remote.pushUrls.join(", ")}`}</text>
														) : null}
														{remoteAccounts && commonDirectory
															? [
																	...new Set([
																		...remote.fetchUrls,
																		...remote.pushUrls,
																	]),
																]
																	.filter((url) => url.startsWith("https://"))
																	.map((url) => (
																		<RemoteAccount
																			key={`${commonDirectory}:${remote.name}:${url}:${accountRevision}`}
																			bindings={remoteAccounts}
																			directory={commonDirectory}
																			label={
																				remote.fetchUrls.includes(url) &&
																				remote.pushUrls.includes(url)
																					? "Account"
																					: remote.fetchUrls.includes(url)
																						? "Fetch account"
																						: "Push account"
																			}
																			remote={remote.name}
																			url={url}
																		/>
																	))
															: null}
													</div>
												}
												trailing={
													<div style={row}>
														<Button
															testId={`remote-edit-${remote.name}`}
															tokens={appTokens}
															variant="ghost"
															size="sm"
															aria-label={`Edit ${remote.name}`}
															disabled={
																locked ||
																editing !== null ||
																(remote.fetchUrls.length !== 1 &&
																	!remoteAccounts)
															}
															onPress={() => {
																returnFocus.current =
																	renderer.getFocusedElementId?.() ?? null;
																setRemoteName(remote.name);
																setRemoteUrl(remote.fetchUrls[0] ?? "");
																setRemoteChoices({});
																setEditing(
																	remote.fetchUrls.length === 1
																		? "edit"
																		: "account"
																);
																setError(null);
																setStatus(null);
															}}
														>
															<svg
																source={accountActionIcons.reconnect}
																style={{
																	width: 14,
																	height: 14,
																	color: appTokens.colors.textMuted,
																}}
															/>
														</Button>
														<Button
															testId={`remote-remove-${remote.name}`}
															tokens={appTokens}
															variant="ghost"
															size="sm"
															aria-label={`Remove ${remote.name}`}
															disabled={locked || editing !== null}
															onPress={() => {
																setRemoving(remote.name);
																setError(null);
															}}
														>
															<svg
																source={accountActionIcons.remove}
																style={{
																	width: 14,
																	height: 14,
																	color: appTokens.colors.danger,
																}}
															/>
														</Button>
													</div>
												}
											/>
										))}
										{data.remotes.some(
											(remote) => remote.fetchUrls.length !== 1
										) ? (
											<text style={muted}>
												Remotes with multiple fetch URLs must be edited in Git
												directly.
											</text>
										) : null}
									</SettingsGroup>
								) : null}
							</>
						) : null}
						{error && !editing ? (
							<text
								testId="git-settings-error"
								role="alert"
								style={{ ...muted, color: appTokens.colors.danger }}
							>
								{error}
							</text>
						) : null}
						{status ? (
							<text testId="git-settings-status" role="status" style={muted}>
								{status}
							</text>
						) : null}
					</SettingsSection>
				</SettingsPage>
			}
			panel={
				editing ? (
					<SettingsPanel
						ref={editor}
						testId={
							editing === "identity" ? "identity-editor" : "remote-editor"
						}
						title={
							editing === "identity"
								? "Edit commit identity"
								: editing === "add"
									? "Add remote"
									: "Edit remote"
						}
						label={
							editing === "identity"
								? "Edit commit identity"
								: editing === "add"
									? "Add remote"
									: "Edit remote"
						}
						scrollTestId="git-settings-editor-scroll"
						footerTestId="git-settings-editor-footer"
						body={
							<>
								{editing === "identity" ? (
									<>
										<div
											role="group"
											aria-label="Identity source"
											style={column}
										>
											{choices.map((choice, index) =>
												index % 2 === 0 ? (
													<div key={choice.key} style={row}>
														{choices.slice(index, index + 2).map((item) => (
															<ChoiceTile
																key={item.key}
																testId={`identity-${item.account ? `account-${item.key}` : item.key}`}
																label={item.label}
																source={item.source}
																detail={item.detail}
																accessibleName={`${item.label}, ${item.detail}`}
																selected={identitySource === item.key}
																disabled={
																	identityLocked ||
																	(!!item.account && !readAccountIdentity)
																}
																onPress={() => {
																	if (item.account) {
																		void chooseAccount(item.account);

																		return;
																	}

																	stopIdentityRequest();
																	setIdentitySource(item.key);
																	setCustom(item.key !== "default");
																	setError(null);
																}}
															/>
														))}
													</div>
												) : null
											)}
										</div>
										{identitySource !== "default" ? (
											<>
												<SettingsField
													id="identity-name"
													label="Name"
													value={name}
													disabled={identityLocked || loadingIdentity}
													onChange={setName}
												/>
												<SettingsField
													id="identity-email"
													label="Commit email"
													value={email}
													disabled={identityLocked || loadingIdentity}
													onChange={setEmail}
												/>
											</>
										) : null}
										{loadingIdentity ? (
											<text
												testId="identity-account-status"
												role="status"
												style={muted}
											>
												Reading account identity…
											</text>
										) : identitySource !== "custom" &&
										  identitySource !== "default" &&
										  !email ? (
											<text
												testId="identity-account-status"
												role="status"
												style={muted}
											>
												Enter a commit email for this account.
											</text>
										) : null}
									</>
								) : (
									<>
										<SettingsField
											id="remote-name"
											label="Remote name"
											value={remoteName}
											disabled={locked || editing !== "add"}
											onChange={setRemoteName}
										/>
										<SettingsField
											ref={remoteUrlField}
											id="remote-url"
											label="Remote URL"
											value={remoteUrl}
											disabled={locked || editing === "account"}
											onChange={setRemoteUrl}
										/>
										{remoteAccounts && commonDirectory
											? accountUrls.map((url) => (
													<RemoteAccount
														key={`${remoteName}:${url}:${accountRevision}`}
														bindings={remoteAccounts}
														directory={commonDirectory}
														remote={remoteName.trim()}
														url={url}
														label={
															accountUrls.length > 1
																? `Account: ${url}`
																: "Authentication"
														}
														value={remoteChoices[url]}
														disabled={locked}
														onChange={(value) =>
															setRemoteChoices((previous) => ({
																...previous,
																[url]: value,
															}))
														}
													/>
												))
											: null}
									</>
								)}
							</>
						}
						footer={
							<>
								{error ? (
									<text
										testId="git-settings-error"
										role="alert"
										style={{ ...muted, color: appTokens.colors.danger }}
									>
										{error}
									</text>
								) : null}
								<div
									style={{
										...row,
										justifyContent: "space-between",
										width: "100%",
									}}
								>
									<Button
										testId={
											editing === "identity"
												? "identity-cancel"
												: "remote-cancel"
										}
										tokens={appTokens}
										variant="secondary"
										size="sm"
										disabled={busy}
										onPress={cancelEditor}
									>
										Cancel
									</Button>
									<Button
										testId={
											editing === "identity" ? "identity-save" : "remote-save"
										}
										tokens={appTokens}
										size="sm"
										disabled={
											editing === "identity"
												? identityLocked ||
													loadingIdentity ||
													!identityChanged ||
													(custom && (!name.trim() || !email.trim()))
												: locked ||
													!remoteName.trim() ||
													!remoteUrl.trim() ||
													(editing === "account" &&
														!Object.keys(remoteChoices).length)
										}
										onPress={() => {
											void save(
												editing === "identity"
													? {
															kind: "identity",
															custom,
															identity: { name, email },
														}
													: {
															kind:
																editing === "add"
																	? "add-remote"
																	: "edit-remote",
															name: remoteName,
															url: remoteUrl,
														}
											);
										}}
									>
										{busy
											? "Saving…"
											: editing === "identity"
												? "Save identity"
												: "Save remote"}
									</Button>
								</div>
							</>
						}
					/>
				) : null
			}
		>
			<Popover
				open={removing !== null}
				modal
				onOpenChange={(open) => {
					if (!open && !busy) setRemoving(null);
				}}
			>
				<PopoverContent
					testId="remote-remove-dialog"
					aria-label="Confirm remote removal"
					placement="center"
					width={340}
					tokens={appTokens}
					dismissible={!busy}
				>
					<div style={column}>
						<text
							role="heading"
							aria-level={2}
							style={styles.sectionTitle}
						>{`Remove ${removing ?? "remote"}?`}</text>
						<text style={muted}>
							Removes the connection, its remote-tracking references and
							tracking configuration. Your local files, local branches, and
							hosted repository remain unchanged.
						</text>
						{error ? (
							<text
								role="alert"
								style={{ ...muted, color: appTokens.colors.danger }}
							>
								{error}
							</text>
						) : null}
						<div style={{ ...row, justifyContent: "flex-end" }}>
							<Button
								testId="remote-remove-cancel"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								disabled={busy}
								onPress={() => setRemoving(null)}
							>
								Cancel
							</Button>
							<Button
								variant="secondary"
								textStyle={{ color: appTokens.colors.danger }}
								testId="remote-remove-confirm"
								tokens={appTokens}
								size="sm"
								disabled={locked || !removing}
								onPress={() => {
									if (removing)
										void save({ kind: "remove-remote", name: removing });
								}}
							>
								{busy ? "Removing…" : "Remove remote"}
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</SettingsSplit>
	);
}
