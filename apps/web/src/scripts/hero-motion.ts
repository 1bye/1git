const hero = document.querySelector<HTMLElement>(".hero");
const product = document.querySelector<HTMLElement>(".hero-product");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (hero && product) {
	let frame = 0;
	let heroTop = 0;
	let heroHeight = 1;
	let visible = true;

	const render = () => {
		frame = 0;

		if (reducedMotion.matches) {
			product.style.removeProperty("transform");

			return;
		}

		const progress = Math.max(
			0,
			Math.min(1, (window.scrollY - heroTop) / (heroHeight * 0.65))
		);

		product.style.transform = `translateY(${(1 - progress) * 30}px) scale(${0.97 + progress * 0.03})`;
	};

	const measure = () => {
		heroTop = hero.getBoundingClientRect().top + window.scrollY;
		heroHeight = hero.offsetHeight;
		render();
	};

	new ResizeObserver(measure).observe(hero);
	new IntersectionObserver(([entry]) => {
		visible = entry?.isIntersecting ?? false;
	}).observe(hero);
	window.addEventListener(
		"scroll",
		() => {
			if (!frame && visible && !reducedMotion.matches)
				frame = requestAnimationFrame(render);
		},
		{ passive: true }
	);
	reducedMotion.addEventListener("change", render);
	measure();
}
