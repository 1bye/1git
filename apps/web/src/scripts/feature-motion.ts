export {};

const section = document.querySelector<HTMLElement>("#features");
const toggle = section?.querySelector<HTMLButtonElement>(".motion-toggle");
const cards = document.querySelectorAll(".feature-card");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let paused = false;

const updateMotion = (): void => {
	section?.toggleAttribute(
		"data-motion-enabled",
		!paused && !reducedMotion.matches && !document.hidden
	);

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
document.addEventListener("visibilitychange", updateMotion);
updateMotion();

const observer = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			entry.target.toggleAttribute(
				"data-in-view",
				entry.isIntersecting && entry.intersectionRatio >= 0.25
			);
		}
	},
	{ threshold: 0.25 }
);

for (const card of cards) {
	observer.observe(card);
}
