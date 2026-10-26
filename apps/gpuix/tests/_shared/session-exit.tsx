import { createTestRoot } from "@gpuix/react/testing";
import { TestGpuixRenderer } from "@gpuix/native";
import { App } from "../../src/app";
import { WorkspaceSessionStore } from "../../src/feature/workspace-tabs/lib/workspace-session-store";
import { repositorySnapshot } from "./repository-snapshot";

const path = process.argv[2];

if (!path) throw new Error("An isolated session path is required.");

const store = new WorkspaceSessionStore(path);
const restored = store.load();

if (!restored.document)
	throw new Error(restored.error ?? "Missing session fixture.");

const root = createTestRoot({ width: 1000, height: 700 });

root.render(
	<App
		initialSession={restored.document}
		saveSession={(document) => store.save(document)}
		readRepository={async () => ({ ok: true, value: repositorySnapshot() })}
	/>
);
const message = root.renderer.findByTestId("commit-message");

if (!message) throw new Error("Missing draft editor.");

root.renderer.focusElement(message.id);
root.renderer.simulateKeystrokes("cmd-a e x i t");
root.renderer.flush();
const dispose: unknown = Reflect.get(TestGpuixRenderer, "disposeCurrent");

if (typeof dispose !== "function")
	throw new Error("Missing native test-session teardown patch.");

// Dispose the test window after the app's exit autosave, before Rust TLS teardown.
process.once("exit", () => dispose());
// GPUIX's normal window-close path calls process.exit; deliberately bypass the autosave timer and unmount.
process.exit(0);
