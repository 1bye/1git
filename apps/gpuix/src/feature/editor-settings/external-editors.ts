import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { WorkspaceSessionStore } from "../workspace-tabs/lib/workspace-session-store";

const execute = promisify(execFile);
const maxPreferenceBytes = 8192;

const applicationNames = [
	"Zed.app",
	"Visual Studio Code.app",
	"Visual Studio Code - Insiders.app",
	"Cursor.app",
	"VSCodium.app",
	"Sublime Text.app",
	"Nova.app",
	"BBEdit.app",
	"TextMate.app",
] as const;

const invalidPathCharacters = /[\r\n\0]/;

/** An installed editor, or the saved choice retained after its application disappears. */
export interface EditorApplication {
	readonly path: string;
	readonly name: string;
	readonly available: boolean;
}

/** App-wide editor preference and macOS application launching; never reads or executes Git's core.editor. */
export class ExternalEditors {
	constructor(
		readonly preferencePath = ExternalEditors.defaultPath(),
		private readonly run: (
			command: string,
			args: readonly string[]
		) => Promise<string> = ExternalEditors.execute,
		private readonly applicationDirectories: readonly string[] = [
			"/Applications",
			join(homedir(), "Applications"),
		]
	) {}

	static defaultPath(): string {
		return (
			process.env.GPUIX_EDITOR_SETTINGS_PATH ??
			join(dirname(WorkspaceSessionStore.defaultPath()), "editor.json")
		);
	}

	private static async execute(
		command: string,
		args: readonly string[]
	): Promise<string> {
		const { stdout } = await execute(command, [...args], {
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: 1024 * 1024,
		});

		return stdout;
	}

	private static requireApplicationPath(path: unknown): asserts path is string {
		if (
			typeof path !== "string" ||
			path.length > 4096 ||
			invalidPathCharacters.test(path) ||
			!isAbsolute(path) ||
			resolve(path) !== path ||
			!/\.app$/i.test(path)
		)
			throw new Error("Choose a macOS application (.app).");
	}

	/** Missing preferences use the default text editor; malformed existing data is never overwritten. */
	load(): string | null {
		try {
			if (statSync(this.preferencePath).size > maxPreferenceBytes)
				throw new Error("Editor preference is too large.");

			const document: unknown = JSON.parse(
				readFileSync(this.preferencePath, "utf8")
			);

			if (
				!document ||
				typeof document !== "object" ||
				!("version" in document) ||
				document.version !== 1 ||
				!("application" in document)
			)
				throw new Error("Invalid editor preference.");

			if (document.application === null) return null;

			ExternalEditors.requireApplicationPath(document.application);

			return document.application;
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return null;

			throw new Error(
				"Could not read the editor preference. The saved file was left unchanged.",
				{ cause }
			);
		}
	}

	private async application(path: string): Promise<EditorApplication> {
		ExternalEditors.requireApplicationPath(path);
		const canonical = await realpath(path);

		ExternalEditors.requireApplicationPath(canonical);

		if (!(await stat(canonical)).isDirectory())
			throw new Error("Choose a macOS application (.app).");

		const info = join(canonical, "Contents", "Info.plist");
		const metadata = await stat(info);

		if (!metadata.isFile() || metadata.size > 1024 * 1024)
			throw new Error("Invalid application metadata.");

		const document: unknown = JSON.parse(
			await this.run("/usr/bin/plutil", ["-convert", "json", "-o", "-", info])
		);

		if (
			!document ||
			typeof document !== "object" ||
			!("CFBundlePackageType" in document) ||
			document.CFBundlePackageType !== "APPL" ||
			!("CFBundleIdentifier" in document) ||
			typeof document.CFBundleIdentifier !== "string" ||
			!/^[a-z0-9][a-z0-9.-]*$/i.test(document.CFBundleIdentifier)
		)
			throw new Error("Choose a valid macOS application (.app).");

		return {
			path: canonical,
			name: basename(canonical).replace(/\.app$/i, ""),
			available: true,
		};
	}

	/** Detect common editors in application folders and preserve custom or unavailable saved choices. */
	async options(): Promise<{
		selected: string | null;
		applications: EditorApplication[];
	}> {
		const selected = this.load();

		const candidates = await Promise.all(
			this.applicationDirectories.flatMap((directory) =>
				applicationNames.map(async (name) => {
					try {
						return await this.application(join(directory, name));
					} catch {
						// Detection is best-effort; custom locations remain available through the native picker.
						return null;
					}
				})
			)
		);

		const unique = new Map<string, EditorApplication>();

		for (const candidate of candidates)
			if (candidate) unique.set(candidate.path, candidate);

		if (selected && !unique.has(selected)) {
			try {
				unique.set(selected, {
					...(await this.application(selected)),
					path: selected,
				});
			} catch {
				unique.set(selected, {
					path: selected,
					name: basename(selected).replace(/\.app$/i, ""),
					available: false,
				});
			}
		}

		return {
			selected,
			applications: [...unique.values()].sort((left, right) =>
				left.name.localeCompare(right.name)
			),
		};
	}

	/** Validate the explicit choice before atomically replacing only this app's preference file. */
	async save(path: string | null): Promise<EditorApplication | null> {
		this.load();
		const application = path === null ? null : await this.application(path);
		const temporary = `${this.preferencePath}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.preferencePath), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(
				temporary,
				`${JSON.stringify({ version: 1, application: application?.path ?? null })}\n`,
				{ flag: "wx", mode: 0o600 }
			);
			renameSync(temporary, this.preferencePath);
		} finally {
			rmSync(temporary, { force: true });
		}

		return application;
	}

	/** Re-read the preference for each explicit file open. An unavailable choice fails instead of silently launching another app. */
	async open(absolute: string): Promise<void> {
		if (process.platform !== "darwin")
			throw new Error("Open in editor currently requires macOS.");

		if (
			!isAbsolute(absolute) ||
			(await realpath(absolute)) !== absolute ||
			!(await stat(absolute)).isFile()
		)
			throw new Error(
				"Only existing regular files can be opened in an editor."
			);

		const selected = this.load();
		let application: EditorApplication | null = null;

		if (selected) {
			try {
				application = await this.application(selected);
			} catch (cause) {
				throw new Error(
					"The selected editor is unavailable. Choose another in Settings.",
					{ cause }
				);
			}
		}

		await this.run(
			"/usr/bin/open",
			application ? ["-a", application.path, absolute] : ["-t", absolute]
		);
	}
}
