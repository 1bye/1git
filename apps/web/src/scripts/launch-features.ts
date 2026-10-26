import { onceOnView } from "./motion";
import { initCommitComposers } from "./commit-composer";

/** Cancellable local demonstrations. No Git, AI, or account requests are made. */
export function initFeatures(): void {
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	const paused = () =>
		reduced.matches ||
		document.hidden ||
		document.documentElement.hasAttribute("data-motion-paused");

	for (const demo of document.querySelectorAll<HTMLElement>(
		"[data-tab-demo]"
	)) {
		const video = demo.querySelector<HTMLVideoElement>("[data-tab-video]");

		if (!video) continue;

		let settled = false;

		const settle = () => {
			settled = true;
			video.pause();
			demo.removeAttribute("data-playing");
		};

		const sync = () => {
			if (paused()) settle();
		};

		video.addEventListener("playing", () => {
			if (settled || paused()) settle();
			else demo.setAttribute("data-playing", "");
		});
		video.addEventListener("ended", settle, { once: true });
		video.addEventListener("error", settle, { once: true });
		onceOnView(
			demo,
			async () => {
				if (settled || paused()) return;

				try {
					await video.play();
				} catch {
					settle();
				}
			},
			settle
		);
		new IntersectionObserver(([entry]) => {
			if (!entry?.isIntersecting && !video.paused) settle();
		}).observe(demo);
		document.addEventListener("motionchange", sync);
		document.addEventListener("visibilitychange", sync);
		reduced.addEventListener("change", sync);
	}

	// Long enough for each pill's scene to grow and be seen before the next.
	const THEME_STEP_MS = 1500;

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
					THEME_STEP_MS
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

	initCommitComposers();
}
