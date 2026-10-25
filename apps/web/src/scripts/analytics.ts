import {
	AnonymousAnalytics,
	type AnalyticsState,
	type AnalyticsStorage,
} from "@1git/analytics/client";

export const analyticsStorageKey = "1git-analytics-v1";

/** Only preferences and attempted-event counters use browser storage; no identity is saved. */
export class BrowserAnalyticsStorage implements AnalyticsStorage {
	read(): unknown {
		const stored = localStorage.getItem(analyticsStorageKey);

		if (stored === null) return null;

		if (stored.length > 4096)
			throw new Error("Oversized analytics preferences.");

		return JSON.parse(stored);
	}

	write(state: AnalyticsState): void {
		localStorage.setItem(analyticsStorageKey, JSON.stringify(state));
	}
}

/** Fixed page categories prevent private paths, query strings, fragments and referrers leaving the browser. */
export function analyticsPage(pathname: string): "home" | "faq" | "not_found" {
	if (pathname === "/") return "home";

	if (pathname === "/faq" || pathname === "/faq/") return "faq";

	return "not_found";
}

/** Installs explicit page/download capture and the persistent footer control once per page load. */
export function initializeAnalytics(active: boolean): void {
	const client = new AnonymousAnalytics({
		source: "website",
		active,
		storage: new BrowserAnalyticsStorage(),
	});

	const controls = document.querySelectorAll<HTMLInputElement>(
		"[data-analytics-toggle]"
	);

	const status = document.querySelector<HTMLElement>("[data-analytics-status]");
	const page = analyticsPage(location.pathname);

	const updateControls = () => {
		for (const control of controls) control.checked = client.enabled;
	};

	for (const control of controls) {
		control.addEventListener("change", () => {
			try {
				client.setEnabled(control.checked);

				if (status) status.hidden = true;
			} catch (error) {
				if (status) {
					status.textContent =
						error instanceof Error
							? error.message
							: "Analytics is off for this visit.";
					status.hidden = false;
				}
			}

			updateControls();
		});
	}

	window.addEventListener("storage", (event) => {
		if (event.key !== analyticsStorageKey && event.key !== null) return;

		client.refresh();
		updateControls();
	});

	document.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) return;

		const link = event.target.closest("a[href]");

		if (!(link instanceof HTMLAnchorElement)) return;

		const target = new URL(link.href);

		if (
			target.origin === "https://git.1bye.dev" &&
			target.pathname === "/download"
		)
			void client.capture({ name: "download_clicked", page });
	});

	updateControls();
	void client.capture({ name: "$pageview", page });
}
