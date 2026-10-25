import { onceOnView } from "./motion";

/** Cancellable local demonstrations. No Git, AI, or account requests are made. */
export function initFeatures(): void {
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	const paused = () =>
		reduced.matches ||
		document.hidden ||
		document.documentElement.hasAttribute("data-motion-paused");

	const grid = document.querySelector<HTMLElement>("[data-even-more]");

	if (grid) {
		const rows = [...grid.querySelectorAll<HTMLElement>("[data-feature-row]")];
		let timer = 0;
		let index = 0;
		let started = false;

		const settle = () => {
			clearTimeout(timer);

			for (const row of rows) row.dataset.spotlight = "done";
		};

		const next = () => {
			if (paused()) {
				settle();

				return;
			}

			const previous = rows[index - 1];

			if (previous) previous.dataset.spotlight = "done";

			const row = rows[index++];

			if (row) {
				row.dataset.spotlight = "active";
				timer = window.setTimeout(next, 380);
			}
		};

		onceOnView(
			grid,
			() => {
				started = true;

				if (paused()) {
					settle();

					return;
				}

				for (const row of rows) row.dataset.spotlight = "waiting";

				next();
			},
			settle
		);
		document.addEventListener("motionchange", () => {
			if (started && paused()) settle();
		});
		document.addEventListener("visibilitychange", () => {
			if (started && document.hidden) settle();
		});
	}

	for (const section of document.querySelectorAll<HTMLElement>(
		"[data-theme-cycler]"
	)) {
		const buttons = [
			...section.querySelectorAll<HTMLButtonElement>("[data-theme-index]"),
		];

		const images = [
			...section.querySelectorAll<HTMLImageElement>(".theme-wallpaper"),
		];

		let timer = 0;
		let index = 0;
		let visible = false;
		let manual = false;

		const select = (value: number) => {
			index = value;

			for (const [i, image] of images.entries())
				image.toggleAttribute("data-active", i === value);

			for (const [i, button] of buttons.entries())
				button.setAttribute("aria-pressed", String(i === value));
		};

		const sync = () => {
			clearInterval(timer);

			if (visible && !paused() && !manual)
				timer = window.setInterval(
					() => select((index + 1) % images.length),
					800
				);
		};

		for (const [i, button] of buttons.entries())
			button.addEventListener("click", () => {
				manual = true;
				select(i);
				sync();
			});

		new IntersectionObserver(
			([entry]) => {
				visible = entry?.isIntersecting ?? false;
				sync();
			},
			{ threshold: 0.35 }
		).observe(section);
		document.addEventListener("visibilitychange", sync);
		document.addEventListener("motionchange", sync);
		reduced.addEventListener("change", sync);
	}

	for (const demo of document.querySelectorAll<HTMLElement>("[data-ai-demo]")) {
		const replay = demo.querySelector<HTMLButtonElement>("[data-ai-replay]");
		const commit = demo.querySelector<HTMLButtonElement>("[data-demo-commit]");
		const draft = demo.querySelector<HTMLElement>("[data-ai-draft]");

		if (!replay || !commit || !draft) continue;

		const timers = new Set<number>();

		const later = (callback: () => void, delayMs: number) => {
			const timer = window.setTimeout(() => {
				timers.delete(timer);
				callback();
			}, delayMs);

			timers.add(timer);
		};

		const settle = () => {
			for (const timer of timers) clearTimeout(timer);

			timers.clear();
			demo.classList.remove("is-working");
			replay.disabled = false;
			commit.disabled = false;
			commit.textContent = "Commit 2 files";
			draft.replaceChildren();
			const type = document.createElement("span");

			type.className = "commit-type";
			type.textContent = "feat";
			draft.append(type, ": add quick switcher");
		};

		const status = (label: string) => {
			const spinner = document.createElement("span");

			spinner.className = "demo-spinner";
			spinner.setAttribute("aria-hidden", "true");
			commit.replaceChildren(spinner, label);
		};

		const play = () => {
			settle();

			if (paused()) return;

			demo.classList.add("is-working");
			replay.disabled = true;
			commit.disabled = true;
			draft.textContent = "Commit message…";
			status("Reading changes…");
			later(() => status("Reviewing…"), 600);
			later(() => status("Writing message…"), 1200);
			later(settle, 1900);
		};

		replay.addEventListener("click", play);
		commit.addEventListener("click", () => {
			if (paused()) return;

			for (const delayMs of [0, 120])
				later(() => {
					const ring = document.createElement("span");

					ring.className = "demo-ring";
					ring.setAttribute("aria-hidden", "true");
					commit.append(ring);
					later(() => ring.remove(), 800);
				}, delayMs);
		});
		onceOnView(demo, play, settle);
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) settle();
		});
		document.addEventListener("motionchange", () => {
			if (paused()) settle();
		});
		reduced.addEventListener("change", () => {
			if (reduced.matches) settle();
		});
	}
}
