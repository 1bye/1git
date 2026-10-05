import { useCallback, useEffect, useRef, useState } from "react";
import { spacing, typography, radius, fontWeight } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { appTokens } from "../../styles/tokens";
import { accountActionIcons } from "../accounts/account-list";
import { StateArtwork } from "../../fixture/state-artwork";
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

const muted = { ...typography.md, color: appTokens.colors.textMuted };

const heading = {
	...typography.lg,
	fontWeight: fontWeight.medium,
	color: appTokens.colors.text,
};

const field = {
	height: appTokens.layout.controlHeight,
	...typography.md,
	color: appTokens.colors.text,
	backgroundColor: "transparent",
	borderWidth: 1,
	borderColor: appTokens.colors.border,
	borderRadius: radius.md,
	paddingLeft: spacing[2.5],
	paddingRight: spacing[2.5],
	flexShrink: 0,
};

function SettingsField({
	id,
	label,
	value,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<div style={column}>
			<text style={muted}>{label}</text>
			<input
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

/** Author settings and explicit remote editors; loading a pane never writes to Git. */
export function GitSettings({
	root,
	page = "identity",
	disabled = false,
	read = GitSettingsModel.read,
	write = GitSettingsModel.write,
	onBusy,
}: {
	root: string | null;
	page?: "identity" | "remotes";
	disabled?: boolean;
	read?: typeof GitSettingsModel.read;
	write?: (
		root: string | null,
		request: GitSettingsRequest
	) => Promise<GitResult<GitSettingsData>>;
	onBusy: (busy: boolean) => void;
}) {
	const [data, setData] = useState<GitSettingsData | null>(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [custom, setCustom] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [editing, setEditing] = useState<"add" | "edit" | null>(null);
	const [remoteName, setRemoteName] = useState("");
	const [remoteUrl, setRemoteUrl] = useState("");
	const [removing, setRemoving] = useState<string | null>(null);
	const pending = useRef(false);
	const mounted = useRef(true);
	const locked = disabled || busy || !data;
	const identityLocked = locked || !!data?.identityReadOnlyReason;

	const apply = useCallback((next: GitSettingsData): void => {
		setData(next);
		setName(next.identity.name ?? "");
		setEmail(next.identity.email ?? "");
		setCustom(next.custom);
	}, []);

	useEffect(() => {
		mounted.current = true;
		setData(null);
		setError(null);
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
		};
	}, [root, read, apply]);

	const save = async (request: GitSettingsRequest): Promise<void> => {
		if (locked || pending.current) return;

		pending.current = true;
		setBusy(true);
		onBusy(true);
		setError(null);
		setStatus(null);

		try {
			const result = await write(root, request);

			if (!mounted.current) return;

			if (result.ok) {
				apply(result.value);
				setEditing(null);
				setRemoving(null);
				setStatus(
					request.kind === "identity"
						? "Identity saved."
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

	return (
		<div
			testId={root ? "repository-settings" : "git-settings"}
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
			}}
		>
			<div
				testId="git-settings-scroll"
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					minHeight: 0,
					overflowY: "scroll",
					padding: spacing[4],
				}}
			>
				<div
					style={{ ...column, maxWidth: 520, width: "100%", gap: spacing[5] }}
				>
					<div style={{ ...row, justifyContent: "space-between" }}>
						<text
							testId="git-settings-heading"
							role="heading"
							aria-level={1}
							style={heading}
						>
							{page === "remotes" ? "Remotes" : "Commit identity"}
						</text>
						{root && page === "remotes" && data ? (
							<Button
								testId="remote-add"
								tokens={appTokens}
								variant="secondary"
								size="sm"
								disabled={locked || editing !== null}
								onPress={() => {
									setRemoteName("");
									setRemoteUrl("");
									setEditing("add");
									setError(null);
									setStatus(null);
								}}
							>
								Add remote
							</Button>
						) : null}
					</div>
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
								<div style={{ ...column, gap: spacing[3] }}>
									{root ? (
										<Checkbox
											testId="identity-custom"
											tokens={appTokens}
											checked={!custom}
											disabled={identityLocked}
											label="Use default identity"
											onCheckedChange={(checked) => setCustom(!checked)}
										/>
									) : null}
									<SettingsField
										id="identity-name"
										label="Name"
										value={name}
										disabled={identityLocked || (!!root && !custom)}
										onChange={setName}
									/>
									<SettingsField
										id="identity-email"
										label="Commit email"
										value={email}
										disabled={identityLocked || (!!root && !custom)}
										onChange={setEmail}
									/>
									{data.identityReadOnlyReason ? (
										<text style={muted}>{data.identityReadOnlyReason}</text>
									) : null}
									<div style={{ ...row, justifyContent: "flex-end" }}>
										<Button
											testId="identity-save"
											tokens={appTokens}
											size="sm"
											disabled={identityLocked || !identityChanged}
											onPress={() => {
												void save({
													kind: "identity",
													custom,
													identity: { name, email },
												});
											}}
										>
											{busy ? "Saving…" : "Save identity"}
										</Button>
									</div>
								</div>
							) : null}
							{root && page === "remotes" ? (
								<div
									style={{
										...column,
										gap: spacing[3],
									}}
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
										<div
											key={remote.name}
											testId={`remote-${remote.name}`}
											style={{ ...row, gap: spacing[3] }}
										>
											<div
												style={{
													...column,
													flexGrow: 1,
													flexShrink: 1,
													minWidth: 0,
													gap: spacing[1],
												}}
											>
												<text
													style={{
														...typography.md,
														color: appTokens.colors.text,
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
												{remote.pushUrls.join() !== remote.fetchUrls.join() ? (
													<text
														style={muted}
													>{`Push: ${remote.pushUrls.join(", ")}`}</text>
												) : null}
											</div>
											<Button
												testId={`remote-edit-${remote.name}`}
												tokens={appTokens}
												variant="ghost"
												size="sm"
												aria-label={`Edit ${remote.name}`}
												disabled={
													locked ||
													editing !== null ||
													remote.fetchUrls.length !== 1
												}
												onPress={() => {
													setRemoteName(remote.name);
													setRemoteUrl(remote.fetchUrls[0] ?? "");
													setEditing("edit");
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
									))}
									{editing ? (
										<div
											testId="remote-editor"
											style={{
												...column,
												padding: spacing[3],
												backgroundColor: appTokens.colors.surface,
												borderRadius: radius.lg,
											}}
										>
											<SettingsField
												id="remote-name"
												label="Remote name"
												value={remoteName}
												disabled={locked || editing === "edit"}
												onChange={setRemoteName}
											/>
											<SettingsField
												id="remote-url"
												label="Remote URL"
												value={remoteUrl}
												disabled={locked}
												onChange={setRemoteUrl}
											/>
											<div style={{ ...row, justifyContent: "flex-end" }}>
												<Button
													testId="remote-cancel"
													tokens={appTokens}
													variant="secondary"
													size="sm"
													disabled={busy}
													onPress={() => setEditing(null)}
												>
													Cancel
												</Button>
												<Button
													testId="remote-save"
													tokens={appTokens}
													size="sm"
													disabled={
														locked || !remoteName.trim() || !remoteUrl.trim()
													}
													onPress={() => {
														void save({
															kind:
																editing === "add"
																	? "add-remote"
																	: "edit-remote",
															name: remoteName,
															url: remoteUrl,
														});
													}}
												>
													Save remote
												</Button>
											</div>
										</div>
									) : null}
									{data.remotes.some(
										(remote) => remote.fetchUrls.length !== 1
									) ? (
										<text style={muted}>
											Remotes with multiple fetch URLs must be edited in Git
											directly.
										</text>
									) : null}
								</div>
							) : null}
						</>
					) : null}
					{error ? (
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
				</div>
			</div>
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
							style={heading}
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
		</div>
	);
}
