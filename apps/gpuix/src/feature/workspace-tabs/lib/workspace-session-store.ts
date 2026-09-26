import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	WorkspaceSession,
	type WorkspaceSessionDocument,
} from "./workspace-session";

const maxSessionBytes = 1024 * 1024;

/** One process's private session file. Invalid existing data is left untouched, with saving disabled. */
export class WorkspaceSessionStore {
	private blocked = false;

	constructor(readonly path: string) {}

	static defaultPath(): string {
		if (process.env.GPUIX_SESSION_PATH) return process.env.GPUIX_SESSION_PATH;

		let directory: string;

		if (process.platform === "darwin")
			directory = join(homedir(), "Library", "Application Support");
		else if (process.platform === "win32")
			directory = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
		else
			directory =
				process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

		return join(directory, "1git-gpuix", "session.json");
	}

	load(): { document?: WorkspaceSessionDocument; error?: string } {
		try {
			if (statSync(this.path).size > maxSessionBytes)
				throw new Error("The saved session exceeds 1 MiB.");

			return {
				document: WorkspaceSession.parse(readFileSync(this.path, "utf8")),
			};
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return {};

			this.blocked = true;

			return {
				error: `Could not restore session. The saved file was left unchanged at ${this.path}. Saving is disabled until it is repaired and the app restarted.`,
			};
		}
	}

	/** Small, debounced writes use atomic replacement; synchronous flush also works during process exit. */
	save(document: WorkspaceSessionDocument): void {
		if (this.blocked)
			throw new Error(
				"Session saving is disabled. Repair the saved file and restart the app."
			);

		const content = `${JSON.stringify(document)}\n`;

		if (Buffer.byteLength(content) > maxSessionBytes)
			throw new Error(
				"Session is too large to save (1 MiB limit). Drafts remain in this window."
			);

		const temporary = `${this.path}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			renameSync(temporary, this.path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
}
