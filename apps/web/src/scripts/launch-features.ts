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
			grid.querySelector<HTMLElement>(".feature-columns") ?? grid,
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

		const frames = [
			...section.querySelectorAll<HTMLElement>("[data-theme-frame]"),
		];

		let timer = 0;
		let index = 0;
		let visible = false;
		let manual = false;

		const select = (value: number) => {
			index = value;

			for (const frame of frames) {
				const active = Number(frame.dataset.themeFrame) === value;

				frame.toggleAttribute("data-active", active);
				frame.inert = !active;
				frame.setAttribute("aria-hidden", String(!active));
			}

			for (const [i, button] of buttons.entries())
				button.setAttribute("aria-pressed", String(i === value));
		};

		const sync = () => {
			clearInterval(timer);

			if (visible && !paused() && !manual)
				timer = window.setInterval(
					() => select((index + 1) % buttons.length),
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
		).observe(section.querySelector(".theme-stage") ?? section);
		document.addEventListener("visibilitychange", sync);
		document.addEventListener("motionchange", sync);
		reduced.addEventListener("change", sync);
	}

	for (const demo of document.querySelectorAll<HTMLElement>("[data-ai-demo]")) {
		const replay = demo.querySelector<HTMLButtonElement>("[data-ai-replay]");
		const commit = demo.querySelector<HTMLButtonElement>("[data-demo-commit]");
		const stop = demo.querySelector<HTMLButtonElement>("[data-ai-stop]");
		const status = demo.querySelector<HTMLElement>("[data-ai-status]");
		const panels = [...demo.querySelectorAll<HTMLElement>("[data-ai-panel]")];

		if (!replay || !commit || !stop || !status) continue;

		const timers = new Set<number>();

		const later = (callback: () => void, delayMs: number) => {
			const timer = window.setTimeout(() => {
				timers.delete(timer);
				callback();
			}, delayMs);

			timers.add(timer);
		};

		const show = (working: boolean) => {
			const state = working ? "busy" : "result";

			demo.dataset.aiState = state;
			demo.classList.toggle("is-working", working);
			replay.disabled = working;
			commit.hidden = working;
			stop.hidden = !working;
			status.textContent = working
				? "Writing message…"
				: "Draft ready: feat: polish repository workspace.";

			for (const panel of panels) {
				const active = panel.dataset.aiPanel === state;

				panel.toggleAttribute("data-active", active);
				panel.inert = !active;
				panel.setAttribute("aria-hidden", String(!active));
			}
		};

		const settle = () => {
			for (const timer of timers) clearTimeout(timer);

			timers.clear();

			for (const ring of commit.querySelectorAll(".demo-ring")) ring.remove();

			show(false);
		};

		const play = () => {
			settle();

			if (paused()) return;

			show(true);
			later(settle, 1200);
		};

		replay.addEventListener("click", play);
		stop.addEventListener("click", settle);
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
