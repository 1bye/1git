import { useEffect, useRef, useState } from "react";
import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Checkbox } from "@1git/gpuix-ui/checkbox";
import { Textarea } from "@1git/gpuix-ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";
import { ChoiceTile } from "../../fixture/choice-tile";
import { useAppTheme } from "../../styles/theme";
import { useAi } from "./ai-provider";
import {
	aiProviderIcons,
	aiProviderNames,
	opencodePlanIcons,
} from "./ai-provider-icons";
import type { AiConnection } from "./lib/ai-settings-store";
import type { AiModel } from "./lib/ai-integration";
import { cavemanCommitPreset } from "./lib/caveman-commit-preset";

/** Scoped account editor. Closing cancels reads; secret input stays in an uncontrolled password field and ref. */
export function AiConnectionEditor({
	ai,
	initial,
	reconnect,
	openLink,
	onBusy,
	onClose,
}: {
	ai: NonNullable<ReturnType<typeof useAi>>;
	initial: AiConnection;
	reconnect: boolean;
	openLink: (url: string) => Promise<void>;
	onBusy: (busy: boolean) => void;
	onClose: () => void;
}) {
	const { tokens } = useAppTheme();
	const [draft, setDraft] = useState(initial);

	const [useDefault, setUseDefault] = useState(
		ai.configuration.defaultId === initial.id
	);

	const [connected, setConnected] = useState<boolean | null>(null);
	const [credentialVersion, setCredentialVersion] = useState(0);
	const [modelVersion, setModelVersion] = useState(0);
	const [models, setModels] = useState<AiModel[]>([]);
	const [loading, setLoading] = useState(false);
	const [modelError, setModelError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [authorizing, setAuthorizing] = useState(false);
	const [editingKey, setEditingKey] = useState(reconnect);
	const [hasKey, setHasKey] = useState(false);
	const [keyVersion, setKeyVersion] = useState(0);
	const key = useRef("");
	const pending = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const service = ai.service;
	const provider = draft.provider;
	const mode = draft.opencodeMode;
	const account = draft.chatgpt;
	const id = draft.id;
	const free = provider === "opencode" && mode === "free";
	const canLoad = free || connected === true;
	const saved = ai.configuration.connections.some((item) => item.id === id);

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

	const label = { ...typography.md, color: tokens.colors.textMuted };

	const field = {
		width: "100%",
		height: tokens.layout.controlHeight,
		...typography.md,
		color: tokens.colors.text,
		backgroundColor: "transparent",
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.md,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
	};

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			pending.current?.abort();
			key.current = "";
		};
	}, []);
	useEffect(() => {
		let cancelled = false;

		if (free) {
			setConnected(false);

			return;
		}

		setConnected(null);
		void (async () => {
			try {
				const result = await service.hasCredentials({
					...initial,
					id,
					provider,
					chatgpt: account,
				});

				if (!cancelled) setConnected(result);
			} catch {
				if (!cancelled) {
					setConnected(false);
					setError(
						"Could not check this connection's saved credentials. Try reconnecting."
					);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [service, initial, id, provider, account, free, credentialVersion]);
	useEffect(() => {
		setModels([]);
		setModelError(null);
		setLoading(false);

		if (!canLoad || busy) return;

		const controller = new AbortController();

		setLoading(true);
		void (async () => {
			try {
				const result = await service.models(
					{ ...initial, id, provider, opencodeMode: mode, chatgpt: account },
					controller.signal
				);

				if (!controller.signal.aborted) setModels(result);
			} catch (cause) {
				if (!controller.signal.aborted)
					setModelError(
						cause instanceof Error ? cause.message : "Could not load AI models."
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();

		return () => controller.abort();
	}, [
		service,
		initial,
		id,
		provider,
		mode,
		account,
		canLoad,
		busy,
		credentialVersion,
		modelVersion,
	]);

	const clearKey = () => {
		key.current = "";
		setHasKey(false);
		setKeyVersion((value) => value + 1);
	};

	const run = async (
		action: (signal: AbortSignal) => Promise<void>,
		authorization = false
	) => {
		if (pending.current) return;

		const controller = new AbortController();

		pending.current = controller;
		setBusy(true);
		setAuthorizing(authorization);
		onBusy(true);
		setError(null);

		try {
			await action(controller.signal);
		} catch (cause) {
			if (mounted.current && !controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Could not save this AI connection."
				);
		} finally {
			pending.current = null;
			onBusy(false);

			if (mounted.current) {
				setBusy(false);
				setAuthorizing(false);
			}
		}
	};

	const connectedNow = () => {
		ai.reload();
		clearKey();
		setEditingKey(false);
		setCredentialVersion((value) => value + 1);
	};

	const save = () =>
		void run(async (signal) => {
			await service.saveConnection(draft, "", useDefault, signal);
			ai.reload();

			if (mounted.current) onClose();
		});

	return (
		<div
			testId="ai-setup-panel"
			role="region"
			aria-label={saved ? "Configure AI account" : "Add AI account"}
			style={{
				...column,
				flexGrow: 1,
				flexBasis: 0,
				borderLeftWidth: 1,
				borderColor: tokens.colors.border,
			}}
		>
			<div style={{ padding: spacing[4], flexShrink: 0 }}>
				<text
					role="heading"
					aria-level={2}
					style={{
						...typography.lg,
						fontWeight: fontWeight.medium,
						color: tokens.colors.text,
					}}
				>
					{saved ? "Configure account" : "Add account"}
				</text>
			</div>
			<div
				testId="ai-settings-scroll"
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
						gap: spacing[3.5],
						width: "100%",
						maxWidth: 480,
						flexShrink: 0,
					}}
				>
					<text style={label}>Provider</text>
					<div
						role="group"
						aria-label="AI provider"
						style={{ ...row, gap: spacing[2], height: 64 }}
					>
						{(["opencode", "chatgpt"] as const).map((target) => (
							<ChoiceTile
								key={target}
								testId={`ai-provider-${target}`}
								label={aiProviderNames[target]}
								source={aiProviderIcons[target]}
								selected={provider === target}
								disabled={busy || saved}
								onPress={() => {
									if (target === provider) return;

									clearKey();
									setEditingKey(false);
									setError(null);
									setDraft({
										...draft,
										provider: target,
										label: aiProviderNames[target],
										model: "",
										chatgpt: undefined,
									});
								}}
							/>
						))}
					</div>
					<text style={label}>Name</text>
					<input
						testId="ai-account-name"
						aria-label="AI account name"
						value={draft.label}
						readOnly={busy}
						onChange={(event) =>
							setDraft({ ...draft, label: (event.value ?? "").slice(0, 160) })
						}
						style={field}
					/>
					{provider === "opencode" ? (
						<>
							<text style={label}>Plan</text>
							<div
								role="group"
								aria-label="OpenCode plan"
								style={{ ...row, height: 64 }}
							>
								{(["free", "go", "zen"] as const).map((plan) => (
									<ChoiceTile
										key={plan}
										testId={`ai-mode-${plan}`}
										label={
											plan === "free" ? "Free" : plan === "go" ? "Go" : "Zen"
										}
										source={opencodePlanIcons[plan]}
										selected={mode === plan}
										accessibleName={`OpenCode ${plan} plan`}
										description={
											mode === plan ? "Selected OpenCode plan" : undefined
										}
										disabled={busy}
										onPress={() => {
											if (plan === mode) return;

											if (plan === "free") {
												clearKey();
												setEditingKey(false);
											}

											setDraft({ ...draft, opencodeMode: plan, model: "" });
										}}
									/>
								))}
							</div>
							{!free && (connected === false || editingKey) ? (
								<>
									<text style={label}>
										{connected ? "Replace API key" : "API key"}
									</text>
									<input
										key={keyVersion}
										testId="ai-api-key"
										type="password"
										aria-label="OpenCode API key"
										placeholder="Paste an OpenCode key"
										readOnly={busy}
										autoFocus={reconnect}
										onChange={(event) => {
											key.current = event.value ?? "";
											setHasKey(!!event.value);
										}}
										style={field}
									/>
									<div style={row}>
										<Button
											testId="ai-save-key"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={busy || !hasKey || !draft.label.trim()}
											onPress={() =>
												void run(async (signal) => {
													await service.connectKey(draft, key.current, signal);

													if (mounted.current) connectedNow();
												})
											}
										>
											Connect
										</Button>
										<Button
											testId="ai-key-console"
											tokens={tokens}
											size="sm"
											variant="ghost"
											disabled={busy}
											onPress={() =>
												void openLink("https://opencode.ai/auth").catch(() => {
													if (mounted.current)
														setError(
															"Could not open OpenCode in your browser."
														);
												})
											}
										>
											Get API key ↗
										</Button>
									</div>
								</>
							) : !free && connected ? (
								<div style={row}>
									<text style={label}>Key saved securely.</text>
									<Button
										testId="ai-replace-key"
										tokens={tokens}
										size="sm"
										variant="ghost"
										disabled={busy}
										onPress={() => setEditingKey(true)}
									>
										Replace key
									</Button>
								</div>
							) : null}
							<text
								style={{ ...typography.sm, color: tokens.colors.textMuted }}
							>
								{free
									? "OpenCode may restrict keyless access from other apps. Some free models may retain prompts or use them for training; avoid sensitive code."
									: mode === "go"
										? "Uses your Go subscription. Check OpenCode for usage limits and balance fallback."
										: "Zen uses your OpenCode balance. Generation may incur charges."}
							</text>
						</>
					) : (
						<>
							{account ? (
								<text testId="ai-chatgpt-account" style={label}>
									{account.email}
								</text>
							) : (
								<text style={label}>
									Authorize ChatGPT plan usage in your browser.
								</text>
							)}
							<div style={row}>
								<Button
									testId="ai-chatgpt-connect"
									tokens={tokens}
									size="sm"
									variant="secondary"
									disabled={busy || !draft.label.trim()}
									onPress={() =>
										void run(async (signal) => {
											const result = await service.connect(
												draft,
												openLink,
												signal
											);

											if (mounted.current) {
												setDraft(result);
												connectedNow();
											}
										}, true)
									}
								>
									{account ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
								</Button>
							</div>
						</>
					)}
					<div style={{ ...row, justifyContent: "space-between" }}>
						<text style={label}>Model</text>
						{loading ? (
							<text
								testId="ai-models-loading"
								role="status"
								style={{ ...typography.sm, color: tokens.colors.textMuted }}
							>
								Loading models…
							</text>
						) : null}
					</div>
					<Select
						key={`${provider}:${mode}:${canLoad}`}
						value={draft.model || undefined}
						onValueChange={(model) => setDraft({ ...draft, model })}
						items={
							models.length
								? models
								: draft.model
									? [{ value: draft.model, label: draft.model }]
									: []
						}
						disabled={busy || loading || !models.length}
					>
						<SelectTrigger
							testId="ai-model"
							aria-label="AI model"
							tokens={tokens}
							style={{ width: "100%" }}
						>
							<SelectValue
								placeholder={
									canLoad ? "Choose a model" : "Connect to load models"
								}
								tokens={tokens}
							/>
						</SelectTrigger>
						<SelectContent tokens={tokens}>
							{models.map((model) => (
								<SelectItem
									key={model.value}
									value={model.value}
									tokens={tokens}
								>
									{model.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{modelError ? (
						<div style={{ ...row, alignItems: "flex-start" }}>
							<text
								testId="ai-models-error"
								role="alert"
								style={{
									...label,
									color: tokens.colors.danger,
									flexGrow: 1,
									flexBasis: 0,
									minWidth: 0,
								}}
							>
								{modelError}
							</text>
							<Button
								testId="ai-models-retry"
								tokens={tokens}
								size="sm"
								variant="ghost"
								disabled={busy}
								onPress={() => setModelVersion((value) => value + 1)}
							>
								Retry
							</Button>
						</div>
					) : null}
					<text style={label}>Commit instructions</text>
					<div style={{ ...column, gap: spacing[2], flexShrink: 0 }}>
						<Textarea
							testId="ai-instructions"
							aria-label="AI commit instructions"
							placeholder="Use Conventional Commits and keep the summary short."
							value={draft.instructions}
							onValueChange={(instructions) =>
								setDraft({
									...draft,
									instructions: instructions.slice(0, 8000),
								})
							}
							readOnly={busy}
							minRows={3}
							maxRows={6}
							tokens={tokens}
						/>
						<Button
							testId="ai-preset-caveman-commit"
							aria-label="Use caveman-commit preset"
							aria-description="Replaces this draft's instructions with the preset. Save preferences to apply."
							tokens={tokens}
							size="sm"
							variant="ghost"
							style={{
								alignSelf: "flex-start",
								paddingLeft: 0,
								paddingRight: 0,
								hover: { backgroundColor: "transparent" },
								active: { backgroundColor: "transparent" },
							}}
							textStyle={{
								...typography.sm,
								color: tokens.colors.focusRing,
								textDecoration: "underline",
							}}
							disabled={busy}
							onPress={() =>
								setDraft({ ...draft, instructions: cavemanCommitPreset })
							}
						>
							Preset: caveman-commit
						</Button>
					</div>
					<Checkbox
						testId="ai-use-default"
						label="Use as default for commit messages"
						checked={useDefault}
						onCheckedChange={setUseDefault}
						disabled={busy}
						tokens={tokens}
					/>
				</div>
			</div>
			<div
				testId="ai-settings-footer"
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
				{error ? (
					<text
						testId="ai-settings-notice"
						role="alert"
						style={{ ...typography.sm, color: tokens.colors.danger }}
					>
						{error}
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
					<Button
						testId="ai-cancel-editor"
						tokens={tokens}
						size="sm"
						variant="secondary"
						disabled={busy && !authorizing}
						onPress={() => {
							if (pending.current) pending.current.abort();
							else onClose();
						}}
					>
						{authorizing ? "Cancel sign-in" : "Cancel"}
					</Button>
					<Button
						testId="ai-save-preferences"
						tokens={tokens}
						size="sm"
						disabled={busy || !draft.model || !draft.label.trim() || !canLoad}
						onPress={save}
					>
						Save preferences
					</Button>
				</div>
			</div>
		</div>
	);
}
