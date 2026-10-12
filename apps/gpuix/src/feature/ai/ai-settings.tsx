import { randomUUID } from "node:crypto";
import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { fontWeight, spacing, typography, radius } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@1git/gpuix-ui/tooltip";
import { useAppTheme } from "../../styles/theme";
import { NativeBrowser } from "../../platform/browser";
import { StateMessage } from "../../fixture/state-message";
import { accountActionIcons } from "../accounts/account-list";
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { useAi } from "./ai-provider";
import { aiProviderIcons, aiProviderNames } from "./ai-provider-icons";
import { AiConnectionEditor } from "./ai-connection-editor";
import { emptyAiPreferences, type AiConnection } from "./lib/ai-settings-store";

/** Settings keyboard navigation closes the connection editor before leaving AI settings. */
export interface AiSettingsHandle {
	cancelEditor: () => boolean;
}

/** Accounts-style list and independent connection editor; credential work stays in the service. */
export function AiSettings({
	openLink = NativeBrowser.open,
	ref,
	onBusy,
}: {
	openLink?: (url: string) => Promise<void>;
	ref?: Ref<AiSettingsHandle>;
	onBusy?: (busy: boolean) => void;
}) {
	const ai = useAi();

	return ai ? (
		<AiSettingsPanel ai={ai} openLink={openLink} ref={ref} onBusy={onBusy} />
	) : null;
}

function AiSettingsPanel({
	ai,
	openLink,
	ref,
	onBusy,
}: {
	ai: NonNullable<ReturnType<typeof useAi>>;
	openLink: (url: string) => Promise<void>;
	ref?: Ref<AiSettingsHandle>;
	onBusy?: (busy: boolean) => void;
}) {
	const { tokens } = useAppTheme();
	const [editing, setEditing] = useState<AiConnection | null>(null);
	const [reconnecting, setReconnecting] = useState(false);
	const [removing, setRemoving] = useState<AiConnection | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const busyCallback = useRef(onBusy);

	busyCallback.current = onBusy;
	useEffect(() => {
		busyCallback.current?.(busy);
	}, [busy]);
	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			pending.current?.abort();
			busyCallback.current?.(false);
		};
	}, []);
	useImperativeHandle(
		ref,
		() => ({
			cancelEditor: () => {
				if (busy) return true;

				if (!editing) return false;

				setEditing(null);

				return true;
			},
		}),
		[busy, editing]
	);

	const locked = busy || !!ai.error;

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
		flexShrink: 0,
	};

	const column = {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		minHeight: 0,
	};

	const heading = {
		...typography.lg,
		fontWeight: fontWeight.medium,
		color: tokens.colors.text,
	};

	const muted = { ...typography.sm, color: tokens.colors.textMuted };

	const openEditor = (connection?: AiConnection, reconnect = false) => {
		if (locked) return;

		setError(null);
		setNotice(null);
		setReconnecting(reconnect);
		setEditing(
			connection ?? {
				...emptyAiPreferences,
				id: randomUUID(),
				label: "OpenCode",
				provider: "opencode",
			}
		);
	};

	const setDefault = (id: string | null) => {
		try {
			ai.setDefault(id);
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not change the default AI connection."
			);
		}
	};

	const remove = async () => {
		if (!removing || pending.current) return;

		const controller = new AbortController();

		pending.current = controller;
		setBusy(true);
		setError(null);

		try {
			const message = await ai.service.disconnect(removing, controller.signal);

			ai.reload();

			if (mounted.current) {
				setRemoving(null);
				setNotice(message);
			}
		} catch (cause) {
			if (mounted.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not remove the AI connection."
				);
		} finally {
			pending.current = null;

			if (mounted.current) setBusy(false);
		}
	};

	return (
		<div
			testId="ai-settings"
			style={{
				...row,
				alignItems: "stretch",
				flexGrow: 1,
				flexShrink: 1,
				minHeight: 0,
				minWidth: 0,
				gap: 0,
			}}
		>
			<div
				testId="ai-list-panel"
				style={{
					...column,
					width: editing ? "50%" : "100%",
					flexGrow: editing ? 0 : 1,
					flexShrink: 0,
				}}
			>
				<div
					style={{
						...column,
						gap: spacing[1],
						padding: spacing[4],
						flexShrink: 0,
						maxWidth: 512,
						width: "100%",
					}}
				>
					<div style={{ ...row, justifyContent: "space-between" }}>
						<text role="heading" aria-level={1} style={heading}>
							AI
						</text>
						<Button
							testId="ai-add"
							tokens={tokens}
							size="sm"
							disabled={locked || !!editing}
							onPress={() => openEditor()}
						>
							Add account
						</Button>
					</div>
					<text style={muted}>Saved AI connections for commit messages.</text>
					{ai.error || error ? (
						<text
							testId="ai-settings-error"
							role="alert"
							style={{ ...muted, color: tokens.colors.danger }}
						>
							{ai.error ?? error}
						</text>
					) : null}
				</div>
				<div
					testId="ai-list-scroll"
					style={{
						...column,
						flexGrow: 1,
						overflowY: "scroll",
						paddingLeft: spacing[4],
						paddingRight: spacing[4],
						paddingBottom: spacing[4],
					}}
				>
					<div
						style={{
							...column,
							width: "100%",
							maxWidth: 480,
							flexGrow: 1,
							flexShrink: 0,
							gap: spacing[5],
						}}
					>
						{!ai.configuration.connections.length ? (
							<StateMessage
								testId="ai-empty"
								artwork="accounts"
								title="No AI accounts added."
								description="Add OpenCode or ChatGPT, then choose a default for commit messages."
							/>
						) : null}
						{ai.configuration.connections.map((connection) => (
							<div
								key={connection.id}
								testId={`ai-account-${connection.id}`}
								role="group"
								aria-label={`${connection.label} · ${aiProviderNames[connection.provider]}`}
								style={{ ...row, gap: spacing[3] }}
							>
								<svg
									source={aiProviderIcons[connection.provider]}
									aria-hidden
									style={{
										width: 22,
										height: 22,
										color: tokens.colors.textMuted,
										flexShrink: 0,
										pointerEvents: "none",
									}}
								/>
								<div
									style={{
										...column,
										gap: spacing[0.5],
										flexGrow: 1,
										flexBasis: 0,
									}}
								>
									<div style={{ ...row, flexWrap: "wrap", gap: spacing[1] }}>
										<text
											style={{ ...typography.md, color: tokens.colors.text }}
										>
											{connection.label}
										</text>
										{ai.configuration.defaultId === connection.id ? (
											<text
												testId={`ai-default-badge-${connection.id}`}
												style={{
													...typography.xs,
													color: tokens.colors.onAccent,
													backgroundColor: tokens.colors.accent,
													paddingLeft: spacing[1],
													paddingRight: spacing[1],
													borderRadius: radius.sm,
												}}
											>
												Default
											</text>
										) : null}
									</div>
									<text
										style={muted}
									>{`${connection.provider === "chatgpt" ? connection.chatgpt?.email || "ChatGPT · Sign-in required" : `OpenCode · ${connection.opencodeMode === "free" ? "Free" : connection.opencodeMode === "go" ? "Go" : "Zen"}`} · ${connection.model || "Choose a model"}`}</text>
								</div>
								<div style={{ ...row, gap: spacing[1] }}>
									<AiRowAction
										testId={`ai-default-${connection.id}`}
										label={`Use ${connection.label} as default`}
										disabled={
											locked ||
											!!editing ||
											ai.configuration.defaultId === connection.id ||
											!connection.model
										}
										onPress={() => setDefault(connection.id)}
										icon="check"
									/>
									<AiRowAction
										testId={`ai-edit-${connection.id}`}
										label={`Configure ${connection.label}`}
										disabled={locked || !!editing}
										onPress={() => openEditor(connection)}
										source={accountActionIcons.reconnect}
									/>
									{connection.provider === "chatgpt" ||
									connection.opencodeMode !== "free" ? (
										<AiRowAction
											testId={`ai-reconnect-${connection.id}`}
											label={`Reconnect ${connection.label}`}
											disabled={locked || !!editing}
											onPress={() => openEditor(connection, true)}
											icon="sync"
										/>
									) : null}
									<AiRowAction
										testId={`ai-remove-${connection.id}`}
										label={`Remove ${connection.label}`}
										disabled={locked || !!editing}
										onPress={() => {
											setError(null);
											setRemoving(connection);
										}}
										source={accountActionIcons.remove}
										danger
									/>
								</div>
							</div>
						))}
					</div>
				</div>
				<div
					testId="ai-list-footer"
					style={{
						...column,
						gap: spacing[2],
						padding: spacing[4],
						paddingTop: spacing[3],
						paddingBottom: spacing[3],
						borderTopWidth: 1,
						borderColor: tokens.colors.border,
						flexShrink: 0,
					}}
				>
					{notice ? (
						<text role="status" style={muted}>
							{notice}
						</text>
					) : null}
					<div
						style={{
							...row,
							justifyContent: "space-between",
							maxWidth: 480,
							width: "100%",
						}}
					>
						<text testId="ai-default-status" style={muted}>
							{ai.configuration.defaultId
								? "Uses your default account."
								: "AI is off. Choose a default account."}
						</text>
						{ai.configuration.defaultId ? (
							<Button
								testId="ai-provider-off"
								tokens={tokens}
								size="sm"
								variant="ghost"
								disabled={locked || !!editing}
								onPress={() => setDefault(null)}
							>
								Turn off
							</Button>
						) : null}
					</div>
				</div>
			</div>
			{editing ? (
				<AiConnectionEditor
					key={editing.id}
					ai={ai}
					initial={editing}
					reconnect={reconnecting}
					openLink={openLink}
					onBusy={setBusy}
					onClose={() => setEditing(null)}
				/>
			) : null}
			<Popover
				open={!!removing}
				onOpenChange={(open) => {
					if (!open && !busy) setRemoving(null);
				}}
			>
				<PopoverContent
					testId="ai-disconnect-confirmation"
					aria-label="Remove AI connection"
					placement="center"
					width={360}
					tokens={tokens}
					dismissible={!busy}
				>
					<div style={{ ...column, gap: spacing[3] }}>
						<text
							role="heading"
							aria-level={2}
							style={{ ...typography.md, color: tokens.colors.text }}
						>{`Remove ${removing?.label ?? "connection"}?`}</text>
						<text style={muted}>
							Remove this connection and its saved credentials from this device.
							Removing the default turns AI off.
						</text>
						{error ? (
							<text
								testId="ai-remove-error"
								role="alert"
								style={{ ...muted, color: tokens.colors.danger }}
							>
								{error}
							</text>
						) : null}
						<div style={{ ...row, justifyContent: "flex-end" }}>
							<Button
								testId="ai-disconnect-cancel"
								tokens={tokens}
								size="sm"
								variant="ghost"
								disabled={busy}
								onPress={() => setRemoving(null)}
							>
								Cancel
							</Button>
							<Button
								testId="ai-disconnect-confirm"
								tokens={tokens}
								size="sm"
								disabled={busy}
								onPress={() => void remove()}
							>
								Remove
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function AiRowAction({
	testId,
	label,
	disabled,
	onPress,
	source,
	icon,
	danger = false,
}: {
	testId: string;
	label: string;
	disabled: boolean;
	onPress: () => void;
	source?: string;
	icon?: "sync" | "check";
	danger?: boolean;
}) {
	const { tokens } = useAppTheme();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					testId={testId}
					tokens={tokens}
					size="sm"
					variant="ghost"
					aria-label={label}
					disabled={disabled}
					onPress={onPress}
					style={{ width: 26, height: 26, padding: 0 }}
				>
					{source ? (
						<svg
							aria-hidden
							source={source}
							style={{
								width: 14,
								height: 14,
								color: danger ? tokens.colors.danger : tokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
					) : (
						<WorkspaceTabIcon name={icon ?? "check"} size={14} />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent tokens={tokens}>{label}</TooltipContent>
		</Tooltip>
	);
}
