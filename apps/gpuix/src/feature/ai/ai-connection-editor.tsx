import { useEffect, useRef, useState } from "react";
import { radius, spacing, typography } from "@1git/design-tokens";
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
import { WorkspaceTabIcon } from "../workspace-tabs/components/workspace-tab-icon";
import { useAppTheme } from "../../styles/theme";
import { useAi } from "./ai-provider";
import {
	aiProviderIcons,
	aiProviderNames,
	opencodePlanIcons,
} from "./ai-provider-icons";
import { AiSettingsStore, type AiConnection } from "./lib/ai-settings-store";
import { findModel, modelEffort, type AiModel } from "./lib/ai-model";
import { SettingsPanel, settingsStyles } from "../settings/settings-layout";
import { cavemanCommitPreset } from "./lib/caveman-commit-preset";
import { AiApiFields } from "./ai-api-fields";

// GPUIX's keyboard selection requires a nonempty option value. Persist defaults as empty strings.
const defaultOption = "1git:default";

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
	const theme = useAppTheme();
	const { tokens } = theme;
	const styles = settingsStyles.get(theme);
	const [draft, setDraft] = useState(initial);
	const [advanced, setAdvanced] = useState(false);

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
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const [pendingAction, setPendingAction] = useState<"sign-in" | "test" | null>(
		null
	);

	const [editingKey, setEditingKey] = useState(reconnect);
	const [hasKey, setHasKey] = useState(false);
	const [keyVersion, setKeyVersion] = useState(0);
	const key = useRef("");
	const pending = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const service = ai.service;
	const provider = draft.provider;
	const chatgptProvider = provider === "chatgpt" || provider === "codex";
	const mode = draft.opencodeMode;
	const account = draft.chatgpt;
	const id = draft.id;
	const executable = draft.executable;
	const free = provider === "opencode" && mode === "free";
	const cli = AiSettingsStore.isCli(provider);
	const canLoad = provider === "api" || cli || free || connected === true;
	const saved = ai.configuration.connections.some((item) => item.id === id);
	const modelChoices = models.slice();
	const selectedModel = findModel(models, draft.model);
	const effort = modelEffort(selectedModel, draft.effort);

	const effortChoices = [
		{ value: defaultOption, label: "Provider default" },
		...(selectedModel?.effort?.levels ?? []),
	];

	const effectiveDraft = {
		...draft,
		effort:
			provider === "api"
				? draft.effort
				: effort || (draft.effort === undefined && !cli ? undefined : ""),
	};

	if (cli)
		modelChoices.unshift({ value: defaultOption, label: "Use CLI default" });

	if (
		draft.model &&
		!models.some((item) => item.value === draft.model) &&
		(cli || !models.length)
	)
		modelChoices.push({ value: draft.model, label: draft.model });

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

	const label = styles.label;

	const field = {
		width: "100%",
		height: tokens.layout.controlHeight,
		...styles.label,
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

		if (free || cli) {
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
	}, [service, initial, id, provider, account, free, cli, credentialVersion]);
	useEffect(() => {
		setModels([]);
		setModelError(null);
		setLoading(false);

		if (provider === "api" || !canLoad || busy) return;

		const controller = new AbortController();

		setLoading(true);
		void (async () => {
			try {
				const result = await service.models(
					{
						...initial,
						id,
						provider,
						opencodeMode: mode,
						chatgpt: account,
						executable,
					},
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
		executable,
	]);

	const clearKey = () => {
		key.current = "";
		setHasKey(false);
		setKeyVersion((value) => value + 1);
	};

	const selectProvider = (target: AiConnection["provider"]) => {
		if (busy || saved || target === provider) return;

		const sameChatgpt =
			chatgptProvider && (target === "chatgpt" || target === "codex");

		clearKey();
		setEditingKey(false);
		setError(null);
		setNotice(null);
		setAdvanced(false);
		setDraft({
			...draft,
			provider: target,
			label:
				sameChatgpt && draft.label !== aiProviderNames[provider]
					? draft.label
					: aiProviderNames[target],
			model: "",
			chatgpt: undefined,
			api:
				target === "api"
					? { protocol: "openai-chat", baseUrl: "https://api.openai.com/v1" }
					: undefined,
			executable: undefined,
			effort: undefined,
		});
	};

	const run = async (
		action: (signal: AbortSignal) => Promise<void>,
		actionKind: "sign-in" | "test" | null = null
	) => {
		if (pending.current) return;

		const controller = new AbortController();

		pending.current = controller;
		setBusy(true);
		setPendingAction(actionKind);
		onBusy(true);
		setError(null);
		setNotice(null);

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
				setPendingAction(null);
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
			await service.saveConnection(
				effectiveDraft,
				provider === "api" ? key.current : "",
				useDefault,
				signal
			);
			ai.reload();

			if (mounted.current) onClose();
		});

	return (
		<SettingsPanel
			testId="ai-setup-panel"
			scrollTestId="ai-settings-scroll"
			footerTestId="ai-settings-footer"
			title={saved ? "Configure account" : "Add account"}
			label={saved ? "Configure AI account" : "Add AI account"}
			body={
				<>
					<text style={label}>Provider</text>
					<div
						role="group"
						aria-label="AI provider"
						style={{ ...row, gap: spacing[2], height: 64 }}
					>
						{(["opencode", "chatgpt", "claude-code", "api"] as const).map(
							(target) => (
								<ChoiceTile
									key={target}
									testId={`ai-provider-${target}`}
									label={aiProviderNames[target]}
									source={aiProviderIcons[target]}
									selected={
										target === "chatgpt" ? chatgptProvider : provider === target
									}
									disabled={busy || saved}
									onPress={() => {
										if (target === "chatgpt" && chatgptProvider) return;

										selectProvider(target === "chatgpt" ? "codex" : target);
									}}
								/>
							)
						)}
					</div>
					{chatgptProvider ? (
						<>
							<text style={label}>Connection</text>
							<div
								role="group"
								aria-label="ChatGPT connection method"
								style={{ ...row, height: 64 }}
							>
								{(["codex", "chatgpt"] as const).map((target) => (
									<ChoiceTile
										key={target}
										testId={`ai-chatgpt-mode-${target === "codex" ? "cli" : "login"}`}
										label={target === "codex" ? "CLI" : "Login"}
										source={aiProviderIcons[target]}
										selected={provider === target}
										accessibleName={
											target === "codex" ? "ChatGPT CLI" : "ChatGPT Login"
										}
										disabled={busy || saved}
										onPress={() => selectProvider(target)}
									/>
								))}
							</div>
						</>
					) : null}
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
							<text style={{ ...styles.description }}>
								{free
									? "OpenCode may restrict keyless access from other apps. Some free models may retain prompts or use them for training; avoid sensitive code."
									: mode === "go"
										? "Uses your Go subscription. Check OpenCode for usage limits and balance fallback."
										: "Zen uses your OpenCode balance. Generation may incur charges."}
							</text>
						</>
					) : provider === "api" ? (
						<AiApiFields
							key={id}
							draft={draft}
							onChange={setDraft}
							onHeadersChange={(raw) => {
								key.current = raw;
							}}
							connected={connected === true}
							reconnect={reconnect}
							busy={busy}
						/>
					) : cli ? (
						<div style={{ ...row, justifyContent: "space-between" }}>
							<text style={label}>
								{`Uses your ${aiProviderNames[provider]} sign-in.`}
							</text>
							<Button
								testId="ai-cli-test"
								aria-description="Tests your CLI account with a small example diff."
								tokens={tokens}
								size="sm"
								variant="secondary"
								disabled={busy}
								onPress={() =>
									void run(async (signal) => {
										const version = await service.cli.check(draft, signal);

										await service.generate(
											effectiveDraft,
											"diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-Hello\n+Hello world\n",
											signal
										);

										if (mounted.current)
											setNotice(`${version} · Connection works.`);
									}, "test")
								}
							>
								Test agent
							</Button>
						</div>
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
										}, "sign-in")
									}
								>
									{account ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
								</Button>
							</div>
						</>
					)}
					{provider !== "api" ? (
						<>
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
								value={
									cli ? draft.model || defaultOption : draft.model || undefined
								}
								onValueChange={(value) => {
									setNotice(null);
									setDraft({
										...draft,
										model: cli && value === defaultOption ? "" : value,
									});
								}}
								items={modelChoices}
								disabled={busy || (!cli && (loading || !models.length))}
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
									{modelChoices.map((model) => (
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
							{selectedModel?.effort?.levels.length !== 0 ? (
								<>
									<text style={label}>Effort</text>
									<Select
										value={effort || defaultOption}
										items={effortChoices}
										disabled={busy || loading || !selectedModel?.effort}
										onValueChange={(value) => {
											const choice = effortChoices.find(
												(item) => item.value === value
											);

											if (!choice) return;

											setNotice(null);
											setDraft({
												...draft,
												effort:
													choice.value === defaultOption ? "" : choice.value,
											});
										}}
									>
										<SelectTrigger
											testId="ai-effort"
											aria-label="AI effort"
											tokens={tokens}
											style={{ width: "100%" }}
										>
											<SelectValue tokens={tokens} />
										</SelectTrigger>
										<SelectContent tokens={tokens}>
											{effortChoices.map((choice) => (
												<SelectItem
													key={choice.value}
													value={choice.value}
													tokens={tokens}
												>
													{choice.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{!selectedModel?.effort ||
									selectedModel.effort.source === "catalog" ? (
										<text
											style={{
												...typography.sm,
												color: tokens.colors.textMuted,
											}}
										>
											{!selectedModel?.effort
												? cli && !draft.model
													? "Uses your CLI's configured effort."
													: "Effort options are unavailable for this model."
												: "Effort options are based on the model catalog."}
										</text>
									) : null}
								</>
							) : null}
						</>
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
					{cli ? (
						<>
							<Button
								testId="ai-cli-advanced"
								tokens={tokens}
								size="sm"
								variant="ghost"
								aria-expanded={advanced}
								disabled={busy}
								style={{ alignSelf: "flex-start", paddingLeft: 0 }}
								onPress={() => setAdvanced(!advanced)}
							>
								<WorkspaceTabIcon
									name={advanced ? "caretDown" : "caretRight"}
								/>
								Advanced
							</Button>
							{advanced ? (
								<div style={{ ...column, gap: spacing[2], flexShrink: 0 }}>
									<text style={label}>Executable path</text>
									<input
										testId="ai-cli-executable"
										aria-label="Agent executable path"
										value={draft.executable ?? ""}
										placeholder={`Auto-detect ${provider === "codex" ? "codex" : "claude"}`}
										readOnly={busy}
										onChange={(event) => {
											setNotice(null);
											setDraft({ ...draft, executable: event.value ?? "" });
										}}
										style={field}
									/>
									<text style={label}>Custom model</text>
									<input
										testId="ai-cli-model"
										aria-label="Custom agent model"
										value={draft.model}
										placeholder="Use CLI default"
										readOnly={busy}
										onChange={(event) => {
											setNotice(null);
											setDraft({ ...draft, model: event.value ?? "" });
										}}
										style={field}
									/>
									<text
										style={{ ...typography.sm, color: tokens.colors.textMuted }}
									>{`Sign in with ${provider === "codex" ? "codex login" : "claude auth login"} in your terminal. Test agent sends an example diff. CLI generation supports up to 64 KiB of selected changes.`}</text>
								</div>
							) : null}
						</>
					) : null}
				</>
			}
			footer={
				<>
					{error ? (
						<text
							testId="ai-settings-notice"
							role="alert"
							style={{ ...styles.error }}
						>
							{error}
						</text>
					) : null}
					{notice ? (
						<text
							testId="ai-cli-notice"
							role="status"
							style={{ ...typography.sm, color: tokens.colors.textMuted }}
						>
							{notice}
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
							testId="ai-cancel-editor"
							tokens={tokens}
							size="sm"
							variant="secondary"
							disabled={busy && !pendingAction}
							onPress={() => {
								if (pending.current) pending.current.abort();
								else onClose();
							}}
						>
							{pendingAction === "sign-in"
								? "Cancel sign-in"
								: pendingAction === "test"
									? "Cancel test"
									: "Cancel"}
						</Button>
						<Button
							testId="ai-save-preferences"
							tokens={tokens}
							size="sm"
							disabled={
								busy ||
								(!cli && !draft.model) ||
								!draft.label.trim() ||
								!canLoad
							}
							onPress={save}
						>
							Save preferences
						</Button>
					</div>
				</>
			}
		/>
	);
}
