import { Button } from "@1git/gpuix-ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	applicationBundlePath,
	installLauncher,
	installLauncherWithPrivilegePrompt,
	launcherLinkStatus,
	systemLauncherDirectory,
	uninstallLauncher,
	uninstallLauncherWithPrivilegePrompt,
	userLauncherDirectory,
	type LauncherInstallOptions,
	type LauncherLinkStatus,
} from "../../launcher/launcher-installation";
import { useAppTheme } from "../../styles/theme";
import { SettingsGroup, SettingsGroupRow } from "./settings-group";
import { SettingsPage, settingsStyles } from "./settings-layout";

type LinkState = {
	readonly system: LauncherLinkStatus;
	readonly user: LauncherLinkStatus;
};

type ActionStatus = {
	readonly kind: "error" | "success";
	readonly message: string;
};

export interface ApplicationSettingsProps {
	readonly bundlePath?: string;
	readonly intent?: ApplicationLauncherIntent;
	readonly onIntentConsumed?: () => void;
	readonly onBusyChange?: (busy: boolean) => void;
	readonly inspect?: typeof launcherLinkStatus;
	readonly installSystem?: (options: LauncherInstallOptions) => Promise<string>;
	readonly uninstallSystem?: (
		options: LauncherInstallOptions
	) => Promise<boolean>;
	readonly installUser?: (options: LauncherInstallOptions) => Promise<string>;
	readonly uninstallUser?: (
		options: LauncherInstallOptions
	) => Promise<boolean>;
}

export type ApplicationLauncherIntent = "install" | "uninstall";

const statusLabel = (status: LauncherLinkStatus): string => {
	if (status === "installed") return "Installed";

	if (status === "different") return "Another command is here";

	return "Not installed";
};

/** Packaged-app command installation; development exposes why PATH actions are unavailable. */
export function ApplicationSettings({
	bundlePath = applicationBundlePath(),
	intent,
	onIntentConsumed,
	onBusyChange,
	inspect = launcherLinkStatus,
	installSystem = installLauncherWithPrivilegePrompt,
	uninstallSystem = uninstallLauncherWithPrivilegePrompt,
	installUser = installLauncher,
	uninstallUser = uninstallLauncher,
}: ApplicationSettingsProps) {
	const theme = useAppTheme();
	const styles = settingsStyles.get(theme);
	const [links, setLinks] = useState<LinkState>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<ActionStatus>();
	const intentHandled = useRef(false);
	const mounted = useRef(true);

	useEffect(
		() => () => {
			mounted.current = false;
		},
		[]
	);

	useEffect(() => {
		onBusyChange?.(busy);

		return () => onBusyChange?.(false);
	}, [busy, onBusyChange]);

	const options = useCallback(
		(targetDirectory: string): LauncherInstallOptions | undefined =>
			bundlePath ? { bundlePath, targetDirectory } : undefined,
		[bundlePath]
	);

	const refresh = useCallback(async () => {
		if (!bundlePath) {
			if (mounted.current) setLinks(undefined);

			return;
		}

		const [system, user] = await Promise.all([
			inspect({ bundlePath, targetDirectory: systemLauncherDirectory }),
			inspect({ bundlePath, targetDirectory: userLauncherDirectory() }),
		]);

		if (mounted.current) setLinks({ system, user });
	}, [bundlePath, inspect]);

	useEffect(() => {
		void refresh().catch((cause: unknown) => {
			if (!mounted.current) return;

			setStatus({
				kind: "error",
				message:
					cause instanceof Error
						? cause.message
						: "Could not inspect command links.",
			});
		});
	}, [refresh]);

	const run = useCallback(
		async (
			targetDirectory: string,
			action: (options: LauncherInstallOptions) => Promise<unknown>,
			success: string
		): Promise<void> => {
			const target = options(targetDirectory);

			if (!target) {
				setStatus({
					kind: "error",
					message: "The 1git command is available only in a packaged app.",
				});

				return;
			}

			setBusy(true);
			setStatus(undefined);

			try {
				await action(target);
				await refresh();

				if (!mounted.current) return;

				setStatus({ kind: "success", message: success });
			} catch (cause: unknown) {
				if (!mounted.current) return;

				setStatus({
					kind: "error",
					message:
						cause instanceof Error
							? cause.message
							: "Could not update the 1git command.",
				});
			} finally {
				if (mounted.current) setBusy(false);
			}
		},
		[options, refresh]
	);

	useEffect(() => {
		if (!intent) {
			if (!busy) intentHandled.current = false;

			return;
		}

		if (intentHandled.current || busy || !links || !bundlePath) return;

		const install = intent === "install";
		const systemInstalled = links.system === "installed";
		const userInstalled = links.user === "installed";

		const targetDirectory = install
			? systemLauncherDirectory
			: systemInstalled
				? systemLauncherDirectory
				: userLauncherDirectory();

		const installed = install ? systemInstalled || userInstalled : false;

		if (
			install
				? installed || links.system === "different"
				: !systemInstalled && !userInstalled
		) {
			intentHandled.current = true;
			onIntentConsumed?.();

			return;
		}

		intentHandled.current = true;
		onIntentConsumed?.();
		void run(
			targetDirectory,
			install
				? targetDirectory === systemLauncherDirectory
					? installSystem
					: installUser
				: targetDirectory === systemLauncherDirectory
					? uninstallSystem
					: uninstallUser,
			install ? "The 1git command is ready." : "The 1git command was removed."
		);
	}, [
		bundlePath,
		busy,
		installSystem,
		installUser,
		intent,
		links,
		onIntentConsumed,
		run,
		uninstallSystem,
		uninstallUser,
	]);

	const button = (
		testId: string,
		label: string,
		onPress: () => void,
		disabled = false
	) => (
		<Button
			testId={testId}
			tokens={theme.tokens}
			variant="secondary"
			size="sm"
			disabled={busy || disabled}
			onPress={onPress}
		>
			{label}
		</Button>
	);

	return (
		<SettingsPage
			testId="application-settings"
			title="Application"
			description="Install the 1git command so local paths open in this app."
			width="single"
		>
			<SettingsGroup
				testId="application-launcher"
				title="Command-line launcher"
				footer={
					bundlePath
						? `The per-user command will be installed at ${userLauncherDirectory()}. Add ~/.local/bin to PATH if your shell cannot find it.`
						: "Command installation is available only in a packaged app."
				}
			>
				<SettingsGroupRow
					testId="application-system-launcher"
					label="All users"
					description="Install in /usr/local/bin. macOS may ask for administrator approval."
					badge={links ? statusLabel(links.system) : "Checking…"}
					trailing={
						links?.system === "installed"
							? button(
									"application-uninstall-system",
									"Uninstall",
									() =>
										void run(
											systemLauncherDirectory,
											uninstallSystem,
											"The system command was removed."
										)
								)
							: button(
									"application-install-system",
									"Install",
									() =>
										void run(
											systemLauncherDirectory,
											installSystem,
											"The system command is ready."
										),
									links?.system === "different"
								)
					}
				/>
				<SettingsGroupRow
					testId="application-user-launcher"
					label="Only me"
					description="Install in ~/.local/bin without administrator access."
					badge={links ? statusLabel(links.user) : "Checking…"}
					trailing={
						links?.user === "installed"
							? button(
									"application-uninstall-user",
									"Uninstall",
									() =>
										void run(
											userLauncherDirectory(),
											uninstallUser,
											"The per-user command was removed."
										)
								)
							: button(
									"application-install-user",
									"Install",
									() =>
										void run(
											userLauncherDirectory(),
											installUser,
											"The per-user command is ready."
										),
									links?.user === "different"
								)
					}
				/>
			</SettingsGroup>
			{status ? (
				<text
					testId="application-status"
					role="alert"
					style={status.kind === "error" ? styles.error : styles.description}
				>
					{status.message}
				</text>
			) : null}
		</SettingsPage>
	);
}
