import { render } from "@gpuix/react";
import { dirname, join } from "node:path";

import { App } from "./app";
import { windowOptions } from "./window-options";
import { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { RepositoryDiscovery } from "./feature/repository-discovery/repository-discovery";
import { RepositoryDiscoveryCache } from "./feature/repository-discovery/repository-discovery-cache";
import { WorkspaceSessionStore } from "./feature/workspace-tabs/lib/workspace-session-store";
import { AppUpdater } from "./app-updater";

const preview = process.env.GPUIX_PREVIEW === "1";

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
	/>,
	{
		...windowOptions,
		focus: process.env.GPUIX_BACKGROUND !== "1",
	}
);

AppUpdater.start();
