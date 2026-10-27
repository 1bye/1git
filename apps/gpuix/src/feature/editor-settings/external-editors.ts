import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
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
const maxPreferenceBytes = 64 * 1024;

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
	/** Changes when an installed bundle is replaced; never persisted as a preference. */
	readonly iconRevision?: string;
}

/** Extensions (leading dot) and exact filenames sharing one app-wide default. */
export interface EditorRule {
	readonly id: string;
	readonly patterns: readonly string[];
	readonly application: string | null;
}

/** Private preferences; one-time file-menu choices never write this document. */
export interface EditorPreferences {
	readonly application: string | null;
	readonly applications: readonly string[];
	readonly rules: readonly EditorRule[];
}

/** App-wide editor preference and macOS application launching; never reads or executes Git's core.editor. */
export class ExternalEditors {
	/** Per-window application metadata only. Settings refreshes it; every launch still validates the app. */
	private readonly catalog = new Map<string, EditorApplication>();
	private discovery?: Promise<void>;
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

	/** Missing preferences use the default text editor; version 1 is upgraded only on an explicit save. */
	preferences(): EditorPreferences {
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
				(document.version !== 1 && document.version !== 2) ||
				!("application" in document)
			)
				throw new Error("Invalid editor preference.");

			const application = document.application;

			if (application !== null)
				ExternalEditors.requireApplicationPath(application);

			if (document.version === 1)
				return {
					application,
					applications: application ? [application] : [],
					rules: [],
				};

			if (
				!("applications" in document) ||
				!Array.isArray(document.applications) ||
				document.applications.length > 64 ||
				!("rules" in document) ||
				!Array.isArray(document.rules) ||
				document.rules.length > 64
			)
				throw new Error("Invalid editor preference.");

			const applications: string[] = [];

			for (const path of document.applications) {
				ExternalEditors.requireApplicationPath(path);

				if (applications.includes(path))
					throw new Error("Duplicate application.");

				applications.push(path);
			}

			const rules: EditorRule[] = [];
			const patterns = new Set<string>();
			const ids = new Set<string>();

			for (const rule of document.rules) {
				if (
					!rule ||
					typeof rule !== "object" ||
					!("id" in rule) ||
					typeof rule.id !== "string" ||
					!rule.id ||
					rule.id.length > 64 ||
					ids.has(rule.id) ||
					!("patterns" in rule) ||
					!("application" in rule)
				)
					throw new Error("Invalid editor rule.");

				const normalized = ExternalEditors.normalizePatterns(rule.patterns);

				if (rule.application !== null)
					ExternalEditors.requireApplicationPath(rule.application);

				for (const pattern of normalized) {
					if (patterns.has(pattern)) throw new Error("Duplicate file type.");

					patterns.add(pattern);
				}

				ids.add(rule.id);
				rules.push({
					id: rule.id,
					patterns: normalized,
					application: rule.application,
				});
			}

			return { application, applications, rules };
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return { application: null, applications: [], rules: [] };

			throw new Error(
				"Could not read the editor preference. The saved file was left unchanged.",
				{ cause }
			);
		}
	}

	/** Overall default, retained for callers that do not need file-type rules. */
	load(): string | null {
		return this.preferences().application;
	}

	private static normalizePatterns(value: unknown): string[] {
		if (!Array.isArray(value) || !value.length || value.length > 32)
			throw new Error(
				"Enter file extensions or exact filenames, separated by commas."
			);

		const patterns: string[] = [];

		for (const item of value) {
			if (
				typeof item !== "string" ||
				!item.trim() ||
				item.length > 255 ||
				invalidPathCharacters.test(item) ||
				/[/\\*?[\],]/.test(item) ||
				item.trim() === "." ||
				item.trim() === ".."
			)
				throw new Error(
					"Use extensions like .tsx or exact filenames like Dockerfile, not paths or wildcards."
				);

			const trimmed = item.trim();
			const pattern = trimmed.startsWith(".") ? trimmed.toLowerCase() : trimmed;

			if (patterns.includes(pattern))
				throw new Error("Each file type can appear only once.");

			patterns.push(pattern);
		}

		return patterns;
	}

	/** Resolve exact filename first, then longest case-insensitive extension, then overall default. */
	static resolve(file: string, preferences: EditorPreferences): string | null {
		const name = basename(file);
		const lowerName = name.toLowerCase();

		const exact = preferences.rules.find((rule) =>
			rule.patterns.includes(name)
		);

		if (exact) return exact.application;

		let longest = 0;
		let application = preferences.application;

		for (const rule of preferences.rules)
			for (const pattern of rule.patterns)
				if (
					pattern.startsWith(".") &&
					name.length > pattern.length &&
					lowerName.endsWith(pattern) &&
					pattern.length > longest
				) {
					longest = pattern.length;
					application = rule.application;
				}

		return application;
	}

	/** Validate a picker result without saving it or launching anything. */
	async application(path: string): Promise<EditorApplication> {
		ExternalEditors.requireApplicationPath(path);
		const canonical = await realpath(path);

		ExternalEditors.requireApplicationPath(canonical);

		const bundle = await stat(canonical);

		if (!bundle.isDirectory())
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
			iconRevision: `${bundle.ino}:${bundle.mtimeMs}:${metadata.ino}:${metadata.mtimeMs}:${metadata.size}`,
		};
	}

	private async detectApplication(
		path: string
	): Promise<EditorApplication | null> {
		// Missing editors are normal during discovery; avoid rejected filesystem lookups.
		if (!existsSync(path)) return null;

		try {
			return await this.application(path);
		} catch {
			// Invalid bundles do not prevent discovering other editors.
			return null;
		}
	}

	/** Warm common applications once per window; Settings explicitly refreshes discovery. */
	async discover(refresh = false): Promise<void> {
		if (!refresh && this.discovery) return await this.discovery;

		// A settings refresh must not race the window's initial discovery.
		if (this.discovery) await this.discovery;

		this.discovery = (async () => {
			const candidates = await Promise.all(
				this.applicationDirectories.flatMap((directory) =>
					applicationNames.map((name) =>
						this.detectApplication(join(directory, name))
					)
				)
			);

			if (refresh) this.catalog.clear();

			for (const candidate of candidates)
				if (candidate) this.catalog.set(candidate.path, candidate);
		})();
		await this.discovery;
	}

	/** Synchronous menu choices from warmed metadata and live preferences; no scans or subprocesses. */
	menu(file: string): {
		selected: string | null;
		applications: EditorApplication[];
	} {
		const preferences = this.preferences();
		const unique = new Map(this.catalog);

		for (const path of [
			preferences.application,
			...preferences.applications,
			...preferences.rules.map((rule) => rule.application),
		])
			if (path && !unique.has(path))
				unique.set(path, {
					path,
					name: basename(path).replace(/\.app$/i, ""),
					available: true,
				});

		return {
			selected: ExternalEditors.resolve(file, preferences),
			applications: [...unique.values()].sort((left, right) =>
				left.name.localeCompare(right.name)
			),
		};
	}

	/** Settings validates saved/custom choices and may refresh installed applications. */
	async options(refresh = false): Promise<{
		selected: string | null;
		rules: readonly EditorRule[];
		applications: EditorApplication[];
	}> {
		const preferences = this.preferences();

		await this.discover(refresh);
		const saved = new Set([
			preferences.application,
			...preferences.applications,
			...preferences.rules.map((rule) => rule.application),
		]);

		await Promise.all(
			[...saved].map(async (path) => {
				if (!path) return;

				const application = await this.detectApplication(path);

				this.catalog.set(
					path,
					application
						? { ...application, path }
						: {
								path,
								name: basename(path).replace(/\.app$/i, ""),
								available: false,
							}
				);
			})
		);

		return {
			selected: preferences.application,
			rules: preferences.rules,
			applications: this.menu("").applications,
		};
	}

	/** Validate the explicit choice before atomically replacing only this app's preference file. */
	async save(path: string | null): Promise<EditorApplication | null> {
		this.preferences();
		const application = path === null ? null : await this.application(path);
		const preferences = this.preferences();

		this.persist({
			...preferences,
			application: application?.path ?? null,
			applications: this.remember(preferences, application),
		});

		if (application) this.catalog.set(application.path, application);

		return application;
	}

	private remember(
		preferences: EditorPreferences,
		application: EditorApplication | null
	): readonly string[] {
		return application
			? [...new Set([...preferences.applications, application.path])]
			: preferences.applications;
	}

	/** Explicitly add/edit one rule, preserving the overall default and rejecting ambiguous duplicates. */
	async saveRule(
		id: string | null,
		input: string,
		path: string | null
	): Promise<EditorRule> {
		const patterns = ExternalEditors.normalizePatterns(
			input.split(",").map((value) => value.trim())
		);

		this.preferences();
		const application = path === null ? null : await this.application(path);
		const preferences = this.preferences();

		if (id && !preferences.rules.some((rule) => rule.id === id))
			throw new Error("This rule no longer exists. Reopen Settings.");

		if (
			preferences.rules.some(
				(rule) =>
					rule.id !== id &&
					rule.patterns.some((pattern) => patterns.includes(pattern))
			)
		)
			throw new Error(
				"A default already exists for one of these file types. Edit that rule instead."
			);

		const rule: EditorRule = {
			id: id ?? randomUUID(),
			patterns,
			application: application?.path ?? null,
		};

		const rules = id
			? preferences.rules.map((item) => (item.id === id ? rule : item))
			: [...preferences.rules, rule];

		this.persist({
			...preferences,
			rules,
			applications: this.remember(preferences, application),
		});

		if (application) this.catalog.set(application.path, application);

		return rule;
	}

	/** Remove only the chosen override; its file types return to the overall default. */
	removeRule(id: string): void {
		const preferences = this.preferences();

		if (!preferences.rules.some((rule) => rule.id === id))
			throw new Error("This rule no longer exists. Reopen Settings.");

		this.persist({
			...preferences,
			rules: preferences.rules.filter((rule) => rule.id !== id),
		});
	}

	private persist(preferences: EditorPreferences): void {
		const content = `${JSON.stringify({ version: 2, ...preferences })}\n`;

		if (
			Buffer.byteLength(content) > maxPreferenceBytes ||
			preferences.rules.length > 64 ||
			preferences.applications.length > 64
		)
			throw new Error("Too many editor defaults or applications.");

		const temporary = `${this.preferencePath}.${randomUUID()}.tmp`;

		mkdirSync(dirname(this.preferencePath), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
			renameSync(temporary, this.preferencePath);
		} finally {
			rmSync(temporary, { force: true });
		}
	}

	/** Re-read the preference for each explicit file open. An unavailable choice fails instead of silently launching another app. */
	async open(absolute: string, override?: string | null): Promise<void> {
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

		const selected =
			override === undefined
				? ExternalEditors.resolve(absolute, this.preferences())
				: override;

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

	/** Opens a repository folder in the configured editor, preserving the same preference validation as file actions. */
	async openDirectory(directory: string): Promise<void> {
		if (process.platform !== "darwin")
			throw new Error("Open in editor currently requires macOS.");

		const absolute = await realpath(directory);

		if (!(await stat(absolute)).isDirectory())
			throw new Error("Only directories can be opened in an editor.");

		const selected = ExternalEditors.resolve(absolute, this.preferences());

		if (!selected)
			throw new Error("Choose an external editor in Settings before opening.");

		const application = await this.application(selected);

		await this.run("/usr/bin/open", ["-a", application.path, absolute]);
	}
}
