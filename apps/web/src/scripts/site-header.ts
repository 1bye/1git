const hero = document.querySelector<HTMLElement>(".hero");
const header = document.querySelector<HTMLElement>(".site-header");

if (hero && header) {
	const setFloating = (floating: boolean) => {
		header.inert = !floating;
		header.toggleAttribute("data-floating", floating);
	};

	setFloating(hero.getBoundingClientRect().bottom <= 0);
	new IntersectionObserver(([entry]) => {
		if (!entry) return;

		// Edge contact counts as intersecting, including on the way back to the hero.
		setFloating(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
	}).observe(hero);
}

export {};
