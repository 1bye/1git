import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { fontWeight, radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { GitIdentity } from "@1git/git";
import { AppShell } from "../../fixture/app-shell";
import { AppearanceChoices } from "../appearance-settings/appearance-settings";
import {
	GitSettingsModel,
	type GitSettingsData,
} from "../git-settings/git-settings-model";
import { settingsNavigation } from "../accounts/lib/settings-shortcut";
import { WorkspaceTabHeading } from "../workspace-tabs/components/workspace-tab";
import type { OnboardingStep } from "../workspace-tabs/lib/workspace-session";
import { workspaceLayout } from "../../styles/workspace-layout";
import { useAppTheme } from "../../styles/theme";

const steps = {
	welcome: { title: "Welcome to 1git", number: 1 },
	git: { title: "Set up Git", number: 2 },
	repository: { title: "Your first repository", number: 3 },
} as const;

/** Skippable native setup. Only Save identity writes Git; account and repository work use existing flows. */
export function Onboarding({
	step,
	active,
	busy,
	error,
	cloneView,
	repositoryActions,
	onStep,
	onSkip,
	onAccounts,
	readIdentity,
	writeIdentity,
	children,
}: {
	step: Exclude<OnboardingStep, "complete">;
	active: boolean;
	busy: boolean;
	error?: string;
	cloneView?: ReactNode;
	repositoryActions: ReactNode;
	onStep: (step: OnboardingStep) => void;
	onSkip: () => void;
	onAccounts: () => void;
	readIdentity: typeof GitSettingsModel.read;
	writeIdentity: typeof GitSettingsModel.write;
	children?: ReactNode;
}) {
	const { tokens } = useAppTheme();
	const renderer = useGpuixRequired();
	const view = useRef<PublicInstance>(null);
	const content = useRef<PublicInstance>(null);
	const [identity, setIdentity] = useState<GitSettingsData>();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [identityError, setIdentityError] = useState<string>();
	const [status, setStatus] = useState<string>();
	const writing = useRef(false);
	const mounted = useRef(true);
	const identityRequest = useRef<AbortController | null>(null);

	const loadIdentity = useCallback(
		async (preserveDraft = false) => {
			identityRequest.current?.abort();
			const request = new AbortController();

			identityRequest.current = request;
			setLoading(true);
			setIdentityError(undefined);

			try {
				const result = await readIdentity(null, request.signal);

				if (request.signal.aborted) return;

				if (!result.ok) throw new Error(result.error.message);

				setIdentity(result.value);

				if (!preserveDraft) {
					setName(result.value.identity.name ?? "");
					setEmail(result.value.identity.email ?? "");
				}
			} catch (cause) {
				if (!request.signal.aborted)
					setIdentityError(
						cause instanceof Error
							? cause.message
							: "Could not read your Git identity."
					);
			} finally {
				if (!request.signal.aborted) setLoading(false);
			}
		},
		[readIdentity]
	);

	useEffect(() => {
		mounted.current = true;
		void loadIdentity();

		return () => {
			mounted.current = false;
			identityRequest.current?.abort();
		};
	}, [loadIdentity]);

	const locked = busy || saving;

	const changed =
		name !== (identity?.identity.name ?? "") ||
		email !== (identity?.identity.email ?? "");

	useEffect(() => {
		if (!active || cloneView) return;

		const navigation = {
			scope: () => view.current?.id ?? null,
			back: () => {},
		};

		settingsNavigation.set(renderer, navigation);
		const timer = setTimeout(() => {
			if (content.current) renderer.focusNextWithin?.(content.current.id);
		}, 0);

		return () => {
			clearTimeout(timer);

			if (settingsNavigation.get(renderer) === navigation)
				settingsNavigation.delete(renderer);
		};
	}, [active, cloneView, renderer, step]);

	const save = async () => {
		if (writing.current || locked || loading || !identity || !changed) return;

		setIdentityError(undefined);
		setStatus(undefined);

		try {
			GitIdentity.validate({ name, email });
		} catch (cause) {
			setIdentityError(
				cause instanceof Error
					? cause.message
					: "Enter a name and valid email address."
			);

			return;
		}

		writing.current = true;
		setSaving(true);

		try {
			const result = await writeIdentity(null, {
				kind: "identity",
				custom: true,
				identity: { name, email },
			});

			if (!mounted.current) return;

			if (!result.ok) {
				// Global name/email writes can partially succeed; reread before an explicit retry.
				const current = await readIdentity(null, new AbortController().signal);

				if (mounted.current)
					setIdentity(current.ok ? current.value : undefined);

				throw new Error(result.error.message);
			}

			setIdentity(result.value);
			setName(result.value.identity.name ?? "");
			setEmail(result.value.identity.email ?? "");
			setStatus("Git identity saved.");
		} catch (cause) {
			if (mounted.current)
				setIdentityError(
					cause instanceof Error
						? cause.message
						: "Could not save your Git identity."
				);
		} finally {
			writing.current = false;

			if (mounted.current) setSaving(false);
		}
	};

	const muted = {
		...typography.sm,
		color: tokens.colors.textMuted,
		whiteSpace: "normal" as const,
	};

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
	};

	const next = step === "welcome" ? "git" : "repository";

	return (
		<AppShell
			ref={view}
			testId="onboarding-view"
			workspaceLabel="Get started"
			hidden={!active}
			toolbar={
				<div
					windowDrag
					style={{
						height: workspaceLayout.toolbarHeight,
						display: "flex",
						alignItems: "end",
						paddingLeft: workspaceLayout.desktopTitlebarControlsWidth,
					}}
				>
					<WorkspaceTabHeading
						label="Get started"
						width={180}
						testId="onboarding-title-tab"
						onClose={onSkip}
						disabled={locked}
					/>
				</div>
			}
		>
			{cloneView ?? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						flexGrow: 1,
						minHeight: 0,
						padding: spacing[5],
					}}
				>
					<div
						testId="onboarding-panel"
						style={{
							display: "flex",
							flexDirection: "column",
							width: "100%",
							maxWidth: 560,
							height: 520,
							maxHeight: "100%",
							minHeight: 0,
						}}
					>
						<div
							style={{
								...row,
								justifyContent: "space-between",
								marginBottom: spacing[5],
								flexShrink: 0,
							}}
						>
							<text
								role="heading"
								aria-level={1}
								style={{ ...typography.xl, fontWeight: fontWeight.medium }}
							>
								{steps[step].title}
							</text>
							<text testId="onboarding-step" style={muted}>
								{`${steps[step].number} of 3`}
							</text>
						</div>
						<div
							ref={content}
							testId="onboarding-content"
							style={{
								display: "flex",
								flexDirection: "column",
								gap: spacing[4],
								flexGrow: 1,
								minHeight: 0,
								overflowY: "scroll",
								paddingBottom: spacing[4],
							}}
						>
							{step === "welcome" ? (
								<>
									<text style={muted}>
										A calm place to review changes and make your next commit.
										Choose a look, or keep the current one.
									</text>
									<AppearanceChoices />
									<text style={muted}>
										You can use 1git locally, without an account. Everything
										here can be changed later in Settings.
									</text>
								</>
							) : step === "git" ? (
								<>
									<text style={muted}>
										Your name and email identify the author of your commits.
									</text>
									{loading ? (
										<text role="status" style={muted}>
											Reading your Git identity…
										</text>
									) : null}
									{(["name", "email"] as const).map((field) => (
										<div
											key={field}
											style={{ gap: spacing[1.5], flexShrink: 0 }}
										>
											<text style={muted}>
												{field === "name" ? "Name" : "Email"}
											</text>
											<input
												testId={`onboarding-${field}`}
												aria-label={
													field === "name"
														? "Commit author name"
														: "Commit author email"
												}
												tabIndex={0}
												value={field === "name" ? name : email}
												readOnly={locked || loading || !identity}
												onChange={(event) => {
													if (field === "name") setName(event.value ?? "");
													else setEmail(event.value ?? "");

													setStatus(undefined);
												}}
												style={{
													...typography.md,
													height: 34,
													paddingLeft: spacing[2.5],
													paddingRight: spacing[2.5],
													color: tokens.colors.text,
													backgroundColor: "transparent",
													borderWidth: 1,
													borderColor: tokens.colors.border,
													borderRadius: radius.md,
												}}
											/>
										</div>
									))}
									<text style={muted}>
										Save identity updates computer-wide Git settings. Continuing
										or skipping does not save edits.
									</text>
									<div style={row}>
										<Button
											testId="onboarding-save-identity"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={locked || loading || !identity || !changed}
											onPress={() => {
												void save();
											}}
										>
											{saving ? "Saving…" : "Save identity"}
										</Button>
										{status ? (
											<text role="status" style={muted}>
												{status}
											</text>
										) : null}
									</div>
									{identityError ? (
										<text
											testId="onboarding-identity-error"
											role="alert"
											style={{ ...muted, color: tokens.colors.danger }}
										>
											{identityError}
										</text>
									) : null}
									{!identity && !loading ? (
										<Button
											testId="onboarding-retry-identity"
											tokens={tokens}
											size="sm"
											variant="secondary"
											disabled={locked}
											style={{ alignSelf: "start" }}
											onPress={() => {
												void loadIdentity(changed);
											}}
										>
											Retry reading identity
										</Button>
									) : null}
									<Button
										testId="onboarding-accounts"
										tokens={tokens}
										variant="ghost"
										size="sm"
										disabled={locked}
										style={{ alignSelf: "start" }}
										onPress={onAccounts}
									>
										Connect GitHub or GitLab…
									</Button>
								</>
							) : (
								<>
									<text style={muted}>
										Open a project on your computer, clone an existing
										repository, or create a new one.
									</text>
									{repositoryActions}
									{busy ? (
										<text role="status" style={muted}>
											Opening repository…
										</text>
									) : null}
									{error ? (
										<text
											role="alert"
											testId="onboarding-repository-error"
											style={{ ...muted, color: tokens.colors.danger }}
										>
											{error}
										</text>
									) : null}
									<text style={muted}>
										You can also skip setup and add a repository later.
									</text>
								</>
							)}
						</div>
						<div
							testId="onboarding-footer"
							style={{
								...row,
								justifyContent: "space-between",
								paddingTop: spacing[3],
								borderTopWidth: 1,
								borderColor: tokens.colors.border,
								flexShrink: 0,
							}}
						>
							<Button
								testId="onboarding-skip"
								tokens={tokens}
								variant="ghost"
								size="sm"
								disabled={locked}
								onPress={onSkip}
							>
								Skip setup
							</Button>
							<div style={row}>
								{step !== "welcome" ? (
									<Button
										testId="onboarding-back"
										tokens={tokens}
										variant="secondary"
										size="sm"
										disabled={locked}
										onPress={() => onStep(step === "git" ? "welcome" : "git")}
									>
										Back
									</Button>
								) : null}
								{step !== "repository" ? (
									<Button
										testId="onboarding-next"
										tokens={tokens}
										size="sm"
										disabled={locked}
										onPress={() => onStep(next)}
									>
										Continue
									</Button>
								) : null}
							</div>
						</div>
					</div>
				</div>
			)}
			{children}
		</AppShell>
	);
}
