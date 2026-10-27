import { render } from "@gpuix/react";
import { dirname, join } from "node:path";

import { App } from "./app";
import { windowOptions } from "./window-options";
import { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { RepositoryDiscovery } from "./feature/repository-discovery/repository-discovery";
import { RepositoryDiscoveryCache } from "./feature/repository-discovery/repository-discovery-cache";
import { WorkspaceSessionStore } from "./feature/workspace-tabs/lib/workspace-session-store";
import { AppUpdater } from "./app-updater";
import { ShellEnvironment } from "./shell-environment";
import { DesktopAnalytics } from "./feature/analytics/desktop-analytics";
import { sendLauncherRequest } from "./launcher/launcher-service";
import { getLauncherRuntime } from "./launcher/launcher-runtime";
import { parseLauncherArguments } from "./launcher/launcher-protocol";

void ShellEnvironment.shared.prepare();

const preview = process.env.GPUIX_PREVIEW === "1";

const launcherRuntime = preview ? undefined : getLauncherRuntime();
const launcherRequests = launcherRuntime?.requests;

const subscribeLauncherRequests =
	launcherRequests?.subscribe.bind(launcherRequests);

const launcherRequest: ReturnType<typeof parseLauncherArguments> = (() => {
	try {
		return parseLauncherArguments(
			process.argv.slice(2),
			process.env.ONEGIT_LAUNCHER_CWD ?? process.cwd()
		);
	} catch (error: unknown) {
		process.stderr.write(
			`1git launcher: ${error instanceof Error ? error.message : String(error)}\n`
		);
		process.exit(2);
	}
})();

if (!preview) {
	if (launcherRequest.path !== undefined)
		launcherRequests?.enqueue(launcherRequest);

	try {
		const started = await launcherRuntime?.service.start();

		if (!started) {
			if (!(await sendLauncherRequest(launcherRequest))) {
				throw new Error(
					"The running 1git instance did not accept the launch request."
				);
			}

			process.exit(0);
		}
	} catch (error: unknown) {
		process.stderr.write(
			`1git launcher unavailable: ${error instanceof Error ? error.message : String(error)}\n`
		);
		process.exit(1);
	}
}

DesktopAnalytics.start(preview);

const session = preview
	? undefined
	: new WorkspaceSessionStore(WorkspaceSessionStore.defaultPath());

const restored = session?.load();

const discoveryCache = session
	? new RepositoryDiscoveryCache(
			join(dirname(session.path), "repository-discovery-v1")
		)
	: undefined;

render(
	<App
		preview={preview}
		initialTabCount={preview ? 8 : 0}
		initialSession={restored?.document}
		initialOnboarding={
			!preview && !restored?.document && !restored?.error
				? "welcome"
				: undefined
		}
		sessionError={restored?.error}
		saveSession={
			session && !restored?.error
				? (document) => session.save(document)
				: undefined
		}
		watchRepository={RepositoryWatcher.watch}
		discoverRepositories={preview ? undefined : RepositoryDiscovery.scan}
		discoveryCache={discoveryCache}
		subscribeLauncherRequests={preview ? undefined : subscribeLauncherRequests}
	/>,
	{
		...windowOptions,
		focus: process.env.GPUIX_BACKGROUND !== "1",
	}
);

AppUpdater.start();
