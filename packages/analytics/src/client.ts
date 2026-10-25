import { analyticsLimits, posthogConfiguration } from "./configuration";

/** Only these aggregate events may leave either application. No arbitrary properties are accepted. */
export type AnalyticsEvent =
	| { name: "app_started" | "onboarding_completed" }
	| {
			name: "feature_used";
			feature: "changes" | "history" | "stashes" | "graph";
	  }
	| {
			name: "$pageview" | "download_clicked";
			page: "home" | "faq" | "not_found";
	  };

/** Preferences and attempted-event counters only; identifiers are never persisted. */
export interface AnalyticsState {
	version: 1;
	enabled: boolean;
	day: string;
	dailyCount: number;
}

/** Synchronous persistence reserves quota before any network request. Missing state returns null. */
export interface AnalyticsStorage {
	read(): unknown;
	write(state: AnalyticsState): void;
}

/** Explicit transport boundary shared by browser fetch and Bun, including local HTTP simulations. */
export type AnalyticsFetch = (
	url: string,
	init: RequestInit
) => Promise<{ ok: boolean }>;

interface AnalyticsOptions {
	source: "desktop" | "website";
	active: boolean;
	storage: AnalyticsStorage;
	version?: string;
	http?: AnalyticsFetch;
	now?: () => Date;
}

const pagePaths = { home: "/", faq: "/faq/", not_found: "/404/" } as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u;
const identityLifetimeMs = 30 * 60 * 1000;

/** Default-on, bounded anonymous capture. Storage failures stop collection; network failures never retry. */
export class AnonymousAnalytics {
	private state: AnalyticsState;
	private identity: { id: string; startedAt: number } | undefined;
	private readonly seen = new Set<string>();
	private readonly requests = new Set<AbortController>();
	private storageFailed = false;
	private readonly now: () => Date;
	private readonly http: AnalyticsFetch;

	constructor(private readonly options: AnalyticsOptions) {
		this.now = options.now ?? (() => new Date());
		this.http = options.http ?? ((url, init) => fetch(url, init));
		this.state = this.emptyState();
		this.refresh();
	}

	get enabled(): boolean {
		return this.state.enabled;
	}

	/** Re-read shared preferences, including another browser tab's opt-out. Invalid state fails closed. */
	refresh(): void {
		if (this.storageFailed) return;

		try {
			const stored = this.options.storage.read();

			if (stored === null) return;

			if (!AnonymousAnalytics.isState(stored))
				throw new Error("Invalid analytics preferences.");

			this.state = {
				version: 1,
				enabled: stored.enabled,
				day: stored.day,
				dailyCount: stored.dailyCount,
			};

			if (!stored.enabled) this.cancel();
		} catch {
			this.storageFailed = true;
			this.state.enabled = false;
			this.cancel();
		}
	}

	/** Takes effect immediately. Quotas survive toggling, and disabling cancels in-flight requests. */
	setEnabled(enabled: boolean): void {
		this.refresh();
		this.state.enabled = enabled;

		if (!enabled) this.cancel();

		try {
			this.options.storage.write({ ...this.state });
			this.storageFailed = false;
		} catch {
			this.storageFailed = true;
			this.state.enabled = false;
			this.cancel();

			throw new Error(
				"Could not save your analytics preference. Analytics is off for this session."
			);
		}
	}

	/** Returns delivery-attempt success, never throws, and never queues or retries dropped events. */
	async capture(event: AnalyticsEvent): Promise<boolean> {
		if (!this.options.active) return false;

		this.refresh();

		if (!this.state.enabled) return false;

		const properties = this.properties(event);

		if (!properties) return false;

		const now = this.now();
		const day = now.toISOString().slice(0, 10);

		if (day > this.state.day)
			this.state = { ...this.state, day, dailyCount: 0 };

		if (this.state.dailyCount >= analyticsLimits.daily) return false;

		if (
			!this.identity ||
			now.getTime() < this.identity.startedAt ||
			now.getTime() - this.identity.startedAt >= identityLifetimeMs
		) {
			const timestamp = now.getTime().toString(16).padStart(12, "0");
			const random = crypto.randomUUID();

			// PostHog sessions require UUIDv7; retain the random UUID's variant and random tail.
			this.identity = {
				id: `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(15)}`,
				startedAt: now.getTime(),
			};
			this.seen.clear();
		}

		const key = JSON.stringify([event.name, properties]);

		if (this.seen.has(key)) return false;

		this.state.dailyCount += 1;

		try {
			this.options.storage.write({ ...this.state });
		} catch {
			this.storageFailed = true;
			this.state.enabled = false;
			this.cancel();

			return false;
		}

		this.seen.add(key);
		const controller = new AbortController();

		const timeout = setTimeout(
			() => controller.abort(),
			analyticsLimits.timeoutMs
		);

		this.requests.add(controller);

		try {
			const response = await this.http(`${posthogConfiguration.host}/i/v0/e/`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "omit",
				referrerPolicy: "no-referrer",
				redirect: "error",
				keepalive: true,
				signal: controller.signal,
				body: JSON.stringify({
					api_key: posthogConfiguration.token,
					event: event.name,
					distinct_id: this.identity.id,
					timestamp: now.toISOString(),
					properties: {
						...properties,
						source: this.options.source,
						$process_person_profile: false,
						$geoip_disable: true,
						$ip: "0.0.0.0",
						$session_id: this.identity.id,
					},
				}),
			});

			return response.ok;
		} catch {
			return false;
		} finally {
			clearTimeout(timeout);
			this.requests.delete(controller);
		}
	}

	private properties(event: AnalyticsEvent): Record<string, string> | null {
		if (this.options.source === "desktop") {
			const version = this.options.version;

			const properties: Record<string, string> =
				version && versionPattern.test(version) ? { app_version: version } : {};

			if (event.name === "app_started" || event.name === "onboarding_completed")
				return properties;

			if (
				event.name === "feature_used" &&
				["changes", "history", "stashes", "graph"].includes(event.feature)
			)
				return { ...properties, feature: event.feature };

			return null;
		}

		if (
			(event.name !== "$pageview" && event.name !== "download_clicked") ||
			!Object.hasOwn(pagePaths, event.page)
		)
			return null;

		const path = pagePaths[event.page];

		return {
			$current_url: `https://git.1bye.dev${path}`,
			$pathname: path,
			$host: "git.1bye.dev",
		};
	}

	private cancel(): void {
		for (const request of this.requests) request.abort();

		this.requests.clear();
		this.identity = undefined;
		this.seen.clear();
	}

	private emptyState(): AnalyticsState {
		const day = this.now().toISOString().slice(0, 10);

		return {
			version: 1,
			enabled: true,
			day,
			dailyCount: 0,
		};
	}

	private static isState(value: unknown): value is AnalyticsState {
		if (!value || typeof value !== "object") return false;

		return (
			"version" in value &&
			value.version === 1 &&
			"enabled" in value &&
			typeof value.enabled === "boolean" &&
			"day" in value &&
			typeof value.day === "string" &&
			datePattern.test(value.day) &&
			"dailyCount" in value &&
			typeof value.dailyCount === "number" &&
			Number.isSafeInteger(value.dailyCount) &&
			value.dailyCount >= 0
		);
	}
}
