const cards = document.querySelectorAll(
	".card-gpu, .card-branches, .card-keyboard"
);

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
