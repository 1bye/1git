/**
 * Covers: packaged command install/uninstall intents shared by Settings and the palette.
 * Real: Application Settings layout and effect-driven action dispatch.
 * Doubles: link inspection and filesystem actions; no privilege prompt or user PATH.
 * Requires: built native addon and macOS graphics access.
 */
import { expect, it, mock } from "bun:test";
import { createTestRoot } from "@gpuix/react/testing";
import {
	ApplicationSettings,
	type ApplicationLauncherIntent,
} from "../../src/feature/settings/application-settings";
import {
	systemLauncherDirectory,
	userLauncherDirectory,
	type LauncherInstallOptions,
	type LauncherLinkStatus,
} from "../../src/launcher/launcher-installation";

const settle = async (
	root: ReturnType<typeof createTestRoot>
): Promise<void> => {
	for (let pass = 0; pass < 6; pass += 1) {
		await Bun.sleep(0);
		root.renderer.flush();
	}
};

const renderIntent = async (
	intent: ApplicationLauncherIntent,
	inspect: (options: LauncherInstallOptions) => Promise<LauncherLinkStatus>,
	action: (options: LauncherInstallOptions) => Promise<unknown>
) => {
	const root = createTestRoot({ width: 800, height: 600 });
	const consumed = mock(() => {});

	root.render(
		<ApplicationSettings
			bundlePath="/tmp/1git.app"
			intent={intent}
			onIntentConsumed={consumed}
			inspect={inspect}
			installSystem={async (options) => String(await action(options))}
			uninstallSystem={async (options) => Boolean(await action(options))}
			installUser={async (options) => String(await action(options))}
			uninstallUser={async (options) => Boolean(await action(options))}
		/>
	);
	await settle(root);

	return { root, consumed };
};

it("starts a packaged install intent through the shared system action", async () => {
	const action = mock(async () => "/usr/local/bin/1git");
	const inspect = mock(async () => "missing" as const);
	const { root, consumed } = await renderIntent("install", inspect, action);

	try {
		expect(consumed).toHaveBeenCalledTimes(1);
		expect(action).toHaveBeenCalledWith({
			bundlePath: "/tmp/1git.app",
			targetDirectory: systemLauncherDirectory,
		});
	} finally {
		root.unmount();
	}
});

it("uninstall intent chooses the existing per-user link without privilege", async () => {
	const action = mock(async () => true);

	const inspect = mock(async ({ targetDirectory }: LauncherInstallOptions) =>
		targetDirectory === userLauncherDirectory() ? "installed" : "missing"
	);

	const { root, consumed } = await renderIntent("uninstall", inspect, action);

	try {
		expect(consumed).toHaveBeenCalledTimes(1);
		expect(action).toHaveBeenCalledWith({
			bundlePath: "/tmp/1git.app",
			targetDirectory: userLauncherDirectory(),
		});
	} finally {
		root.unmount();
	}
});
