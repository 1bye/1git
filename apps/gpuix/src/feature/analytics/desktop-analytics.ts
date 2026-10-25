import {
	AnonymousAnalytics,
	type AnalyticsEvent,
	type AnalyticsState,
	type AnalyticsStorage,
} from "@1git/analytics/client";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { WorkspaceSessionStore } from "../workspace-tabs/lib/workspace-session-store";
import { version } from "../../../package.json";

/** Private, atomic preferences and counters stored separately from workspace and repository data. */
export class AnalyticsFileStorage implements AnalyticsStorage {
	constructor(
		readonly path = join(
			dirname(WorkspaceSessionStore.defaultPath()),
			"analytics.json"
		)
	) {}

	read(): unknown {
		try {
			if (statSync(this.path).size > 4096)
				throw new Error("Oversized analytics preferences.");

			return JSON.parse(readFileSync(this.path, "utf8"));
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return null;

			throw error;
		}
	}

	write(state: AnalyticsState): void {
		const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;

		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

		try {
			writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
				flag: "wx",
				mode: 0o600,
			});
			renameSync(temporary, this.path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
}

/** Process-level lifecycle. Importing components and rendering test roots never activates capture. */
export class DesktopAnalytics {
	private static client: AnonymousAnalytics | undefined;

	static preferences(): AnonymousAnalytics {
		this.client ??= new AnonymousAnalytics({
			source: "desktop",
			active: false,
			storage: new AnalyticsFileStorage(),
		});

		return this.client;
	}

	/** Called once by the real entry point; development and preview remain offline. */
	static start(preview: boolean): void {
		this.client = new AnonymousAnalytics({
			source: "desktop",
			active: process.env.NODE_ENV === "production" && !preview,
			version: process.env.ONEGIT_APP_VERSION ?? version,
			storage: new AnalyticsFileStorage(),
		});

		void this.client.capture({ name: "app_started" });
	}

	static async capture(event: AnalyticsEvent): Promise<void> {
		await this.client?.capture(event);
	}
}
