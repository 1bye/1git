export type Point = [number, number];

/** Points per outline: enough for smooth curves at the sizes drawn. */
export const SAMPLES = 96;

/** Redistribute a polyline into `count` points evenly spaced along its length. */
export function resample(points: Point[], count = SAMPLES): Point[] {
	const lengths = [0];

	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1] as Point;
		const [bx, by] = points[i] as Point;

		lengths.push((lengths[i - 1] as number) + Math.hypot(bx - ax, by - ay));
	}

	const total = lengths.at(-1) ?? 0;
	const out: Point[] = [];
	let segment = 1;

	for (let i = 0; i < count; i++) {
		const target = (total * i) / (count - 1);

		while (segment < points.length - 1 && (lengths[segment] as number) < target)
			segment++;

		const start = lengths[segment - 1] as number;
		const span = (lengths[segment] as number) - start || 1;
		const t = (target - start) / span;
		const [ax, ay] = points[segment - 1] as Point;
		const [bx, by] = points[segment] as Point;

		out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
	}

	return out;
}

const curve = (steps: number, at: (t: number) => Point): Point[] =>
	Array.from({ length: steps + 1 }, (_, i) => at(i / steps));

const mirror = (points: Point[]): Point[] =>
	points.map(([x, y]) => [-x, y] as Point).reverse();

/*
 * Closed, filled silhouettes in a unit box (−1…1). Rooted shapes have their
 * base at (0, 1), so they read as growing out of whatever hides that point.
 */
const rose = (): Point[] => {
	const right: Point[] = [
		[0.08, 1],
		[0.08, 0.1],
		...curve(10, (t) => [
			0.08 + 0.48 * Math.sin((t * Math.PI) / 2),
			0.1 - 0.52 * (1 - Math.cos((t * Math.PI) / 2)),
		]),
		[0.6, -0.64],
		[0.64, -0.92],
		[0.3, -0.7],
		[0, -1],
	];

	const leaf: Point[] = [
		[-0.08, 0.42],
		[-0.36, 0.28],
		[-0.62, 0.32],
		[-0.44, 0.52],
		[-0.08, 0.6],
	];

	const left = mirror(right.slice(1));

	return [...right, ...left.slice(1), ...leaf, [-0.08, 1], [0.08, 1]];
};

const pine = (): Point[] => [
	[0.1, 1],
	[0.1, 0.74],
	[0.66, 0.74],
	[0.24, 0.18],
	[0.52, 0.18],
	[0.14, -0.36],
	[0.38, -0.36],
	[0, -1],
	[-0.38, -0.36],
	[-0.14, -0.36],
	[-0.52, 0.18],
	[-0.24, 0.18],
	[-0.66, 0.74],
	[-0.1, 0.74],
	[-0.1, 1],
	[0.1, 1],
];

const sparkle = (): Point[] =>
	curve(64, (t) => {
		const angle = t * Math.PI * 2;
		const c = Math.cos(angle);
		const s = Math.sin(angle);

		return [
			Math.sign(c) * Math.abs(c) ** 2.4,
			Math.sign(s) * Math.abs(s) ** 2.4,
		];
	});

// The axle hole is cut through a hairline slit; evenodd filling opens it.
const gear = (): Point[] => [
	...curve(96, (t) => {
		const angle = t * Math.PI * 2;
		const tooth = Math.max(-1, Math.min(1, Math.sin(angle * 8) * 3));
		const radius = 0.8 + 0.18 * tooth;

		return [radius * Math.cos(angle), radius * Math.sin(angle)];
	}),
	...curve(24, (t) => {
		const angle = t * Math.PI * 2;

		return [0.3 * Math.cos(angle), 0.3 * Math.sin(angle)];
	}),
	[0.8, 0],
];

const petal = (): Point[] =>
	curve(32, (t) => {
		const angle = t * Math.PI * 2;

		// A teardrop pointed at its tip, like a falling petal.
		return [0.62 * Math.sin(angle) * Math.sin(angle / 2), -Math.cos(angle)];
	});

const bird = (): Point[] => {
	const wing = (x: number) =>
		-0.5 * Math.abs(Math.sin(Math.PI * x)) + 0.25 * Math.abs(x);

	const top = curve(24, (t) => {
		const x = t * 2 - 1;

		return [x, wing(x)] as Point;
	});

	const bottom = curve(24, (t) => {
		const x = 1 - t * 2;

		return [x, wing(x) + 0.22 * (1 - Math.abs(x))] as Point;
	});

	return [...top, ...bottom];
};

const spark = (): Point[] => [
	[-1, 0],
	[0, -0.2],
	[1, 0],
	[0, 0.2],
	[-1, 0],
];

export const shapes = {
	rose: resample(rose()),
	pine: resample(pine()),
	sparkle: resample(sparkle()),
	gear: resample(gear()),
	petal: resample(petal()),
	bird: resample(bird()),
	spark: resample(spark()),
} as const;

export type ShapeName = keyof typeof shapes;
export type Idle = "sway" | "drift" | "flap" | "twinkle" | "spin" | "spin-back";

export interface Piece {
	shape: ShapeName;
	/** Anchor on the pill as a fraction of its width and height. */
	ax: number;
	ay: number;
	/** Pixel offset from the anchor to the piece's pivot. */
	ox: number;
	oy: number;
	/** Half-size in pixels: the unit box's 1. */
	size: number;
	/** Rooted pieces pivot at their base and grow out of the pill. */
	rooted?: boolean;
	rotate?: number;
	idle: Idle;
	phase: number;
}

const rooted = (
	ax: number,
	size: number,
	rotate: number,
	phase: number
): Piece => ({
	shape: "rose",
	ax,
	ay: 0,
	ox: 0,
	oy: 6,
	size,
	rooted: true,
	rotate,
	idle: "sway",
	phase,
});

/** Each theme uses the same number of pieces, so every piece always has a destination. */
export const scenes: Record<string, Piece[]> = {
	Rose: [
		rooted(0.5, 20, 0, 0),
		rooted(0.3, 14, -8, 1.3),
		rooted(0.7, 15, 8, 2.1),
		rooted(0.12, 12, -30, 0.7),
		rooted(0.88, 12, 30, 2.8),
		{
			shape: "petal",
			ax: 0.5,
			ay: 0,
			ox: -42,
			oy: -40,
			size: 4,
			rotate: -30,
			idle: "drift",
			phase: 0.4,
		},
		{
			shape: "petal",
			ax: 0.5,
			ay: 0,
			ox: 46,
			oy: -34,
			size: 4.5,
			rotate: 40,
			idle: "drift",
			phase: 1.9,
		},
		{
			shape: "petal",
			ax: 0.5,
			ay: 0,
			ox: -74,
			oy: -14,
			size: 3.5,
			rotate: 10,
			idle: "drift",
			phase: 3.1,
		},
		{
			shape: "petal",
			ax: 0.5,
			ay: 0,
			ox: 80,
			oy: -12,
			size: 3.5,
			rotate: -20,
			idle: "drift",
			phase: 4.2,
		},
		{
			shape: "petal",
			ax: 0.5,
			ay: 0,
			ox: 12,
			oy: -60,
			size: 3,
			rotate: 60,
			idle: "drift",
			phase: 5.4,
		},
	],
	Forest: [
		{ ...rooted(0.5, 20, 0, 0.2), shape: "pine" },
		{ ...rooted(0.32, 14, 0, 1.1), shape: "pine" },
		{ ...rooted(0.68, 15, 0, 2.4), shape: "pine" },
		{ ...rooted(0.14, 11, 0, 3.3), shape: "pine" },
		{ ...rooted(0.86, 12, 0, 4.1), shape: "pine" },
		{
			shape: "bird",
			ax: 0.5,
			ay: 0,
			ox: -40,
			oy: -52,
			size: 6,
			idle: "flap",
			phase: 0,
		},
		{
			shape: "bird",
			ax: 0.5,
			ay: 0,
			ox: -20,
			oy: -64,
			size: 4.5,
			idle: "flap",
			phase: 1.2,
		},
		{
			shape: "bird",
			ax: 0.5,
			ay: 0,
			ox: 42,
			oy: -48,
			size: 5,
			idle: "flap",
			phase: 2.1,
		},
		{
			shape: "bird",
			ax: 0.5,
			ay: 0,
			ox: 64,
			oy: -60,
			size: 4,
			idle: "flap",
			phase: 3.4,
		},
		{
			shape: "bird",
			ax: 0.5,
			ay: 0,
			ox: 10,
			oy: -74,
			size: 3.5,
			idle: "flap",
			phase: 4.6,
		},
	],
	// Stars and sparks surround the pill on every side.
	Cosmic: [
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 0,
			oy: -48,
			size: 10,
			idle: "twinkle",
			phase: 0,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: -52,
			oy: -38,
			size: 6,
			idle: "twinkle",
			phase: 1.1,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 54,
			oy: -40,
			size: 7,
			idle: "twinkle",
			phase: 2.3,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: -96,
			oy: -8,
			size: 7,
			idle: "twinkle",
			phase: 0.6,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 98,
			oy: 6,
			size: 8,
			idle: "twinkle",
			phase: 3.2,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: -86,
			oy: 30,
			size: 4.5,
			idle: "twinkle",
			phase: 4.4,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 84,
			oy: -30,
			size: 4,
			idle: "twinkle",
			phase: 1.7,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: -28,
			oy: 46,
			size: 6,
			idle: "twinkle",
			phase: 2.9,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 36,
			oy: 48,
			size: 5,
			idle: "twinkle",
			phase: 5.1,
		},
		{
			shape: "sparkle",
			ax: 0.5,
			ay: 0.5,
			ox: 110,
			oy: -18,
			size: 3,
			idle: "twinkle",
			phase: 3.8,
		},
	],
	// Meshing gears at opposite corners, with sparks thrown off around them.
	Workshop: [
		{
			shape: "gear",
			ax: 1,
			ay: 0,
			ox: -14,
			oy: -6,
			size: 20,
			idle: "spin",
			phase: 0,
		},
		{
			shape: "gear",
			ax: 1,
			ay: 0,
			ox: 18,
			oy: -32,
			size: 12,
			idle: "spin-back",
			phase: 0.2,
		},
		{
			shape: "gear",
			ax: 0,
			ay: 1,
			ox: 12,
			oy: 8,
			size: 15,
			idle: "spin-back",
			phase: 0.4,
		},
		{
			shape: "spark",
			ax: 1,
			ay: 0,
			ox: 34,
			oy: -4,
			size: 5,
			rotate: 20,
			idle: "twinkle",
			phase: 0.3,
		},
		{
			shape: "spark",
			ax: 1,
			ay: 0,
			ox: -42,
			oy: -30,
			size: 4,
			rotate: -40,
			idle: "twinkle",
			phase: 1.4,
		},
		{
			shape: "sparkle",
			ax: 1,
			ay: 0,
			ox: 38,
			oy: -48,
			size: 4,
			idle: "twinkle",
			phase: 2.2,
		},
		{
			shape: "spark",
			ax: 0,
			ay: 1,
			ox: -16,
			oy: -4,
			size: 5,
			rotate: -20,
			idle: "twinkle",
			phase: 3.1,
		},
		{
			shape: "spark",
			ax: 0,
			ay: 1,
			ox: 34,
			oy: 26,
			size: 4,
			rotate: 35,
			idle: "twinkle",
			phase: 4.2,
		},
		{
			shape: "sparkle",
			ax: 0,
			ay: 1,
			ox: -22,
			oy: 22,
			size: 3.5,
			idle: "twinkle",
			phase: 5,
		},
		{
			shape: "sparkle",
			ax: 1,
			ay: 0,
			ox: -40,
			oy: 6,
			size: 3,
			idle: "twinkle",
			phase: 0.9,
		},
	],
};

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Place a piece around a pill, applying its idle motion at `time` seconds. */
export function placePiece(
	piece: Piece,
	pill: Rect,
	time: number,
	idle: number,
	scale = 1
): Point[] {
	const size = piece.size * scale;
	const pivotX = pill.left + pill.width * piece.ax + piece.ox * scale;
	const pivotY = pill.top + pill.height * piece.ay + piece.oy * scale;
	const wave = Math.sin(time * 1.6 + piece.phase);
	let angle = piece.rotate ?? 0;
	let grow = 1;
	let shiftX = 0;
	let shiftY = 0;
	let flapY = 1;

	switch (piece.idle) {
		case "sway":
			angle += 3 * wave * idle;
			break;
		case "drift":
			shiftX = 3 * wave * idle;
			shiftY = 2 * Math.cos(time * 1.2 + piece.phase) * idle;
			angle += 10 * wave * idle;
			break;
		case "flap":
			flapY = 1 + 0.45 * Math.sin(time * 7 + piece.phase) * idle;
			shiftX = 2.5 * wave * idle;
			break;
		case "twinkle":
			grow = 1 + 0.22 * Math.sin(time * 3.2 + piece.phase) * idle;
			break;
		case "spin":
			angle += time * 24 * idle;
			break;
		case "spin-back":
			angle -= time * 38 * idle;
			break;
	}

	const radians = (angle * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const baseY = piece.rooted ? 1 : 0;

	return shapes[piece.shape].map(([x, y]) => {
		const px = x * size * grow;
		const py = (y - baseY) * size * grow * flapY;

		return [
			pivotX + shiftX + px * cos - py * sin,
			pivotY + shiftY + px * sin + py * cos,
		];
	});
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * The point a piece scales out of: rooted pieces grow from their base on the
 * pill's edge; the rest emerge from the nearest point on the pill.
 */
export function growOrigin(
	piece: Piece,
	points: Point[],
	pill: Rect,
	scale = 1
): Point {
	if (piece.rooted)
		return [
			pill.left + pill.width * piece.ax + piece.ox * scale,
			pill.top + pill.height * piece.ay + piece.oy * scale,
		];

	const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
	const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;

	return [
		clamp(cx, pill.left, pill.left + pill.width),
		clamp(cy, pill.top, pill.top + pill.height),
	];
}

/** Scale a placed shape toward `origin`: 0 collapses it there, 1 leaves it as is. */
export function scaleFrom(
	points: Point[],
	[ox, oy]: Point,
	k: number
): Point[] {
	return points.map(([x, y]) => [ox + (x - ox) * k, oy + (y - oy) * k]);
}

const OVERSHOOT = 1.9;

/** Ease out with a small overshoot, so pieces pop slightly past full size. */
export const easeOutBack = (t: number): number =>
	1 + (OVERSHOOT + 1) * (t - 1) ** 3 + OVERSHOOT * (t - 1) ** 2;
export const easeIn = (t: number): number => t ** 3;
