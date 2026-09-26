import { render } from "@gpuix/react";

import { App } from "./app";
import { windowOptions } from "./window-options";
import { RepositoryWatcher } from "./feature/repository-workspace/lib/repository-watcher";
import { WorkspaceSessionStore } from "./feature/workspace-tabs/lib/workspace-session-store";

const preview = process.env.GPUIX_PREVIEW === "1";

const session = preview
	? undefined
	: new WorkspaceSessionStore(WorkspaceSessionStore.defaultPath());

const restored = session?.load();

render(
	<App
		preview={preview}
		initialTabCount={preview ? 8 : 1}
		initialSession={restored?.document}
		sessionError={restored?.error}
		saveSession={
			session && !restored?.error
				? (document) => session.save(document)
				: undefined
		}
		watchRepository={RepositoryWatcher.watch}
	/>,
	{
		...windowOptions,
		focus: process.env.GPUIX_BACKGROUND !== "1",
	}
);
