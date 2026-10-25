export type SceneState = "before" | "active" | "after";

/** Keep long scenes active while their content crosses the viewport centre. */
export function sceneState(
	top: number,
	bottom: number,
	center: number
): SceneState {
	if (bottom <= center) return "after";

	if (top > center) return "before";

	return "active";
}

/** Observe a thin viewport-centre strip, recalculating its pixel inset on resize. */
export function observeViewportCenter(
	targets: Element[],
	callback: IntersectionObserverCallback
): () => void {
	let observer: IntersectionObserver;
	let resizeFrame = 0;

	const connect = () => {
		observer?.disconnect();
		// Percentage root margins use viewport width, so pixels matter on wide screens.
		const inset = Math.max(0, Math.floor(innerHeight / 2) - 1);

		observer = new IntersectionObserver(callback, {
			rootMargin: `-${inset}px 0px -${inset}px 0px`,
		});

		for (const target of targets) observer.observe(target);
	};

	const resize = () => {
		cancelAnimationFrame(resizeFrame);
		resizeFrame = requestAnimationFrame(connect);
	};

	connect();
	window.addEventListener("resize", resize);

	return () => {
		observer.disconnect();
		cancelAnimationFrame(resizeFrame);
		window.removeEventListener("resize", resize);
	};
}

/** Native snapping owns scrolling; this controller only stages scene content. */
export function initScenes(): void {
	const scenes = [...document.querySelectorAll<HTMLElement>("[data-scene]")];

	if (scenes.length < 2) return;

	const root = document.documentElement;
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	const sync = () => {
		const enabled =
			!reduced.matches && !root.hasAttribute("data-motion-paused");

		root.toggleAttribute("data-scenes-ready", enabled);

		for (const scene of scenes) {
			const { top, bottom } = scene.getBoundingClientRect();

			scene.dataset.sceneState = enabled
				? sceneState(top, bottom, innerHeight / 2)
				: "active";
		}
	};

	observeViewportCenter(scenes, sync);
	document.addEventListener("motionchange", sync);
	reduced.addEventListener("change", sync);
	window.addEventListener("resize", sync);
	sync();
}
