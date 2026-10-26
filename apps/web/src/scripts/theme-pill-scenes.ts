import {
	easeIn,
	easeOutBack,
	growOrigin,
	placePiece,
	scaleFrom,
	scenes,
	type Point,
	type Rect,
} from "./pill-shapes";

const GROW_MS = 620;
const SHRINK_MS = 320;
const STAGGER_MS = 45;
const STACKED_WIDTH = 768;
const STACKED_SCALE = 0.72;
const SVG_NS = "http://www.w3.org/2000/svg";

const toPath = (points: Point[]): string =>
	`M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;

const progress = (
	now: number,
	start: number,
	delay: number,
	duration: number
) => Math.max(0, Math.min(1, (now - start - delay) / duration));

interface Layer {
	paths: SVGPathElement[];
	pill: number;
	start: number;
	/** The point on the pill each piece scales out of, or back into. */
	origins: Point[];
	/** Where outgoing pieces were when they began to shrink. */
	snapshot: Point[][];
}

/** Each theme's silhouettes scale out of the active pill and back into it. */
export function initPillScenes(): void {
	for (const controls of document.querySelectorAll<HTMLElement>(
		"[data-pill-scenes]"
	)) {
		const svg = controls.querySelector<SVGSVGElement>("svg");

		const buttons = [
			...controls.querySelectorAll<HTMLButtonElement>("[data-theme-index]"),
		];

		const count = scenes.Rose?.length ?? 0;

		if (!svg || buttons.length === 0 || count === 0) continue;

		const makePaths = () =>
			Array.from({ length: count }, () => {
				const path = document.createElementNS(SVG_NS, "path");

				svg.append(path);

				return path;
			});

		// Two path sets trade places: one scales in while the other shrinks away.
		const sets = [makePaths(), makePaths()] as const;
		const reduced = matchMedia("(prefers-reduced-motion: reduce)");

		const still = () =>
			reduced.matches ||
			document.documentElement.hasAttribute("data-motion-paused");

		const pressed = () =>
			Math.max(
				0,
				buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true")
			);

		let which = 0;

		let incoming: Layer = {
			paths: sets[0],
			pill: pressed(),
			start: 0,
			origins: [],
			snapshot: [],
		};

		let outgoing: Layer = { ...incoming, paths: sets[1] };
		let current: Point[][] = [];
		let frame = 0;
		let visible = false;

		const pillRect = (index: number): Rect => {
			const box = svg.getBoundingClientRect();

			const pill = (
				buttons[index] as HTMLButtonElement
			).getBoundingClientRect();

			return {
				left: pill.left - box.left,
				top: pill.top - box.top,
				width: pill.width,
				height: pill.height,
			};
		};

		const scene = (index: number) =>
			scenes[(buttons[index] as HTMLButtonElement).textContent?.trim() ?? ""] ??
			scenes.Rose ??
			[];

		const pieceScale = () => (innerWidth < STACKED_WIDTH ? STACKED_SCALE : 1);

		const targets = (index: number, time: number, idle: number): Point[][] => {
			const rect = pillRect(index);

			return scene(index).map((piece) =>
				placePiece(piece, rect, time, idle, pieceScale())
			);
		};

		const originsFor = (index: number, shapes: Point[][]): Point[] => {
			const rect = pillRect(index);

			return scene(index).map((piece, i) =>
				growOrigin(piece, shapes[i] ?? [], rect, pieceScale())
			);
		};

		const grow = (index: number, now: number) => {
			incoming = {
				...incoming,
				pill: index,
				start: now,
				origins: originsFor(index, targets(index, now / 1000, 0)),
			};
		};

		const render = (now: number) => {
			const motion = !still();
			const goal = targets(incoming.pill, now / 1000, motion ? 1 : 0);

			current = goal.map((to, i) => {
				const path = incoming.paths[i] as SVGPathElement;
				const origin = incoming.origins[i];

				const k = easeOutBack(
					progress(now, incoming.start, i * STAGGER_MS, GROW_MS)
				);

				const points = motion && origin ? scaleFrom(to, origin, k) : to;

				path.setAttribute("d", toPath(points));

				return points;
			});

			for (const [i, path] of outgoing.paths.entries()) {
				const from = outgoing.snapshot[i];
				const origin = outgoing.origins[i];

				const t = progress(
					now,
					outgoing.start,
					(i * STAGGER_MS) / 3,
					SHRINK_MS
				);

				if (!motion || !from || !origin || t >= 1) {
					path.removeAttribute("d");
					continue;
				}

				path.setAttribute("d", toPath(scaleFrom(from, origin, 1 - easeIn(t))));
			}
		};

		const tick = (now: number) => {
			render(now);
			frame = requestAnimationFrame(tick);
		};

		const sync = () => {
			cancelAnimationFrame(frame);

			if (visible && !document.hidden && !still())
				frame = requestAnimationFrame(tick);
			else {
				frame = 0;
				render(performance.now());
			}
		};

		const change = (index: number) => {
			if (index === incoming.pill) return;

			const now = performance.now();

			// The scene on screen shrinks back into the pill it grew from.
			outgoing = {
				paths: incoming.paths,
				pill: incoming.pill,
				start: now,
				snapshot: current,
				origins: incoming.origins,
			};
			which = 1 - which;
			incoming = { ...incoming, paths: sets[which] as SVGPathElement[] };
			grow(index, now);
			sync();
		};

		new MutationObserver(() => change(pressed())).observe(controls, {
			attributes: true,
			attributeFilter: ["aria-pressed"],
			subtree: true,
		});

		new IntersectionObserver(([entry]) => {
			const wasVisible = visible;

			visible = entry?.isIntersecting ?? false;

			// Each time the row comes into view the scene grows in afresh.
			if (visible && !wasVisible) grow(incoming.pill, performance.now());

			sync();
		}).observe(controls);

		document.addEventListener("visibilitychange", sync);
		document.addEventListener("motionchange", sync);
		reduced.addEventListener("change", sync);
		addEventListener("resize", () => {
			if (!frame) render(performance.now());
		});

		grow(incoming.pill, performance.now());
		render(performance.now());
	}
}
