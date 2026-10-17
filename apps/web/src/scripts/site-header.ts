const hero = document.querySelector<HTMLElement>(".hero");
const header = document.querySelector<HTMLElement>(".site-header");

if (hero && header) {
	new IntersectionObserver(([entry]) => {
		if (!entry) return;

		const floating = entry.boundingClientRect.bottom <= 0;

		header.inert = !floating;
		header.toggleAttribute("data-floating", floating);
	}).observe(hero);
}

export {};
