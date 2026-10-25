import {
	readMotionPreference,
	writeMotionPreference,
} from "./motion-preference";

/** Shared film timing for browser motion; CSS counterparts live in site.css. */
export const easings = {
	accelerate: "cubic-bezier(0.333, 0, 0.667, 0)",
	decelerate: "cubic-bezier(0.333, 1, 0.667, 1)",
	out: "cubic-bezier(0.2, 0.75, 0.34, 0.94)",
	spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
	app: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/** Run once when a section becomes readable. Reduced motion immediately settles. */
export function onceOnView(
	element: HTMLElement,
	enter: () => void,
	settle: () => void = enter
): void {
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	if (reduced.matches) {
		settle();

		return;
	}

	let entered = false;

	const observer = new IntersectionObserver(
		([entry]) => {
			if (entry?.isIntersecting && !entered) {
				entered = true;
				observer.disconnect();
				enter();
			}
		},
		{
			threshold: Math.min(
				0.35,
				(innerHeight / Math.max(element.offsetHeight, 1)) * 0.35
			),
		}
	);

	observer.observe(element);
	reduced.addEventListener(
		"change",
		() => {
			if (reduced.matches) {
				entered = true;
				observer.disconnect();
				settle();
			}
		},
		{ once: true }
	);
}

/** Setup is progressive enhancement: without JS all content stays readable. */
export function initMotion(): void {
	for (const section of document.querySelectorAll<HTMLElement>(
		"[data-reveal]"
	)) {
		onceOnView(section, () => section.classList.add("is-visible"));
	}

	const toggle = document.querySelector<HTMLButtonElement>(
		"[data-motion-toggle]"
	);

	if (toggle) {
		const initial = readMotionPreference();

		document.documentElement.toggleAttribute("data-motion-paused", initial);
		toggle.setAttribute("aria-pressed", String(initial));
		toggle.textContent = initial ? "Resume animations" : "Pause animations";
		toggle.hidden = false;
		toggle.addEventListener("click", () => {
			const paused =
				!document.documentElement.hasAttribute("data-motion-paused");

			document.documentElement.toggleAttribute("data-motion-paused", paused);
			toggle.setAttribute("aria-pressed", String(paused));
			toggle.textContent = paused ? "Resume animations" : "Pause animations";
			writeMotionPreference(paused);
			document.dispatchEvent(new Event("motionchange"));
		});
	}
}
