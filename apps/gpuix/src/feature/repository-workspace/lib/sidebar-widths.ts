/** Window-wide sidebar widths in logical pixels, shared across repository tabs. */
export interface SidebarWidths {
	readonly files: number;
	readonly graph: number;
}

/** Sidebar limits keep navigation usable and leave space for the main content. */
export const sidebarWidthLimits = {
	files: { min: 240, max: 600, default: 310 },
	graph: { min: 180, max: 420, default: 230 },
} as const;

/** Validates saved layout preferences before they reach native layout. */
export class SidebarWidthPreferences {
	static parse(value: unknown): SidebarWidths {
		const record = typeof value === "object" && value !== null ? value : {};

		const width = (
			candidate: unknown,
			limits: { min: number; max: number; default: number }
		): number =>
			typeof candidate === "number" && Number.isFinite(candidate)
				? Math.min(limits.max, Math.max(limits.min, candidate))
				: limits.default;

		return {
			files: width(
				"files" in record ? record.files : undefined,
				sidebarWidthLimits.files
			),
			graph: width(
				"graph" in record ? record.graph : undefined,
				sidebarWidthLimits.graph
			),
		};
	}
}
