export {};

const section = document.querySelector<HTMLElement>("#features");
const toggle = section?.querySelector<HTMLButtonElement>(".motion-toggle");
const cards = document.querySelectorAll<HTMLElement>(".feature-card");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const hoverPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const returnDurationMs = 420;

const motionProperties = [
	"transform",
	"opacity",
	"fill",
	"stroke",
	"strokeDashoffset",
	"width",
] as const;

let paused = false;

const readFrame = (element: Element) => {
	const style = getComputedStyle(element);

	return {
		transform: style.transform,
		opacity: style.opacity,
		fill: style.fill,
		stroke: style.stroke,
		strokeDashoffset: style.strokeDashoffset,
		width: style.width,
	};
};

const bindHover = (card: HTMLElement) => {
	let hoverAnimations: CSSAnimation[] = [];
	let returning: Animation[] = [];
	let generation = 0;

	const reset = (): void => {
		generation += 1;

		for (const animation of returning) animation.cancel();

		returning = [];
		hoverAnimations = [];
		card.removeAttribute("data-artwork-hover");
	};

	const enter = (): void => {
		if (
			returning.length ||
			card.hasAttribute("data-artwork-hover") ||
			!section?.hasAttribute("data-motion-enabled") ||
			!hoverPointer.matches ||
			!card.hasAttribute("data-in-view") ||
			!card.matches(":hover")
		)
			return;

		const existing = new Set(card.getAnimations({ subtree: true }));

		card.setAttribute("data-artwork-hover", "");
		hoverAnimations = card
			.getAnimations({ subtree: true })
			.filter(
				(animation): animation is CSSAnimation =>
					animation instanceof CSSAnimation && !existing.has(animation)
			);
	};

	card.addEventListener("pointerenter", enter);
	card.addEventListener("pointerleave", async () => {
		if (returning.length) return;

		const currentGeneration = ++generation;

		// Keep the hover selector until we have sampled the actual interrupted frame.
		const frames = hoverAnimations.flatMap((animation) => {
			const effect = animation.effect;

			if (
				!(effect instanceof KeyframeEffect) ||
				!(effect.target instanceof Element)
			)
				return [];

			return [{ element: effect.target, from: readFrame(effect.target) }];
		});

		hoverAnimations = [];
		card.removeAttribute("data-artwork-hover");
		returning = frames.flatMap(({ element, from }) => {
			const to = readFrame(element);

			const changed = motionProperties.filter(
				(property) => from[property] !== to[property]
			);

			if (!changed.length) return [];

			return [
				element.animate(
					[
						Object.fromEntries(
							changed.map((property) => [property, from[property]])
						),
						Object.fromEntries(
							changed.map((property) => [property, to[property]])
						),
					],
					{ duration: returnDurationMs, easing: "cubic-bezier(.22, 1, .36, 1)" }
				),
			];
		});

		await Promise.allSettled(returning.map((animation) => animation.finished));

		if (generation !== currentGeneration) return;

		returning = [];
		// A quick re-entry waits for the short return instead of jumping to frame zero.
		enter();
	});

	return { enter, reset };
};

const hoverControllers = new Map<Element, ReturnType<typeof bindHover>>();

const updateMotion = (): void => {
	const enabled = !paused && !reducedMotion.matches && !document.hidden;

	section?.toggleAttribute("data-motion-enabled", enabled);

	for (const controller of hoverControllers.values()) {
		if (enabled && hoverPointer.matches) controller.enter();
		else controller.reset();
	}

	if (!toggle) return;

	toggle.hidden = reducedMotion.matches;
	toggle.toggleAttribute("data-paused", paused);

	const label = paused ? "Play artwork animations" : "Pause artwork animations";

	toggle.setAttribute("aria-label", label);
	toggle.title = label;
};

toggle?.addEventListener("click", () => {
	paused = !paused;
	updateMotion();
});
reducedMotion.addEventListener("change", updateMotion);
hoverPointer.addEventListener("change", updateMotion);
document.addEventListener("visibilitychange", updateMotion);

const observer = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			const inView = entry.isIntersecting && entry.intersectionRatio >= 0.25;

			entry.target.toggleAttribute("data-in-view", inView);

			const controller = hoverControllers.get(entry.target);

			if (inView) controller?.enter();
			else controller?.reset();
		}
	},
	{ threshold: 0.25 }
);

for (const card of cards) {
	hoverControllers.set(card, bindHover(card));
	observer.observe(card);
}

updateMotion();
