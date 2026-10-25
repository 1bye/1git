import type { EventPayload } from "@gpuix/react";
import type { SpaceDirection } from "./workspace-spaces";

const swipeDistancePx = 48;
const axisDecisionPx = 12;
const horizontalDominance = 1.5;

/** One horizontal trackpad navigation per touch sequence; wheel input and momentum cannot rearm it. Owned by the mounted rail. */
export class RailSpaceSwipe {
	private active = false;
	private x = 0;
	private y = 0;

	cancel(): void {
		this.active = false;
		this.x = 0;
		this.y = 0;
	}

	update(
		event: Pick<
			EventPayload,
			"deltaX" | "deltaY" | "precise" | "touchPhase" | "modifiers"
		>
	): SpaceDirection | null {
		if (event.touchPhase === "started") {
			this.cancel();
			this.active = true;
		} else if (event.touchPhase !== "moved") {
			this.cancel();

			return null;
		}

		const x = event.deltaX ?? 0;
		const y = event.deltaY ?? 0;

		if (
			event.precise !== true ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			event.modifiers?.cmd ||
			event.modifiers?.ctrl ||
			event.modifiers?.alt ||
			event.modifiers?.shift
		) {
			this.cancel();

			return null;
		}

		if (!this.active) return null;

		this.x += x;
		this.y += y;
		const distanceX = Math.abs(this.x);
		const distanceY = Math.abs(this.y);

		if (distanceY >= axisDecisionPx && distanceY >= distanceX) {
			this.cancel();

			return null;
		}

		if (
			distanceX < swipeDistancePx ||
			distanceX < distanceY * horizontalDominance
		)
			return null;

		const direction = this.x < 0 ? "next" : "previous";

		this.cancel();

		return direction;
	}
}
