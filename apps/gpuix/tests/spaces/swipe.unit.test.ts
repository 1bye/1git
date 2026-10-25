/**
 * Covers: gesture thresholds, horizontal intent, single navigation, cancellation and momentum rejection.
 * Real: rail swipe recognizer.
 * Doubles: trackpad/wheel event payloads and touch phases.
 * Requires: none.
 */
import { expect, it } from "bun:test";
import { RailSpaceSwipe } from "../../src/feature/spaces/rail-space-swipe";

it("accumulates horizontal motion and switches only once before a new touch sequence", () => {
	const swipe = new RailSpaceSwipe();

	expect(
		swipe.update({ precise: true, touchPhase: "started", deltaX: 0 })
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -20, deltaY: 3 })
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -29, deltaY: 4 })
	).toBe("next");
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -100 })
	).toBeNull();
	expect(swipe.update({ precise: true, touchPhase: "ended" })).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -100 })
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "started", deltaX: 55 })
	).toBe("previous");
});

it("ignores gestures that started elsewhere, small motion, vertical scrolling and diagonal intent", () => {
	const swipe = new RailSpaceSwipe();

	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -80 })
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "started", deltaX: -10 })
	).toBeNull();
	expect(swipe.update({ precise: true, touchPhase: "ended" })).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "started", deltaY: -20 })
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -80 })
	).toBeNull();
	expect(
		swipe.update({
			precise: true,
			touchPhase: "started",
			deltaX: -48,
			deltaY: -40,
		})
	).toBeNull();
	expect(swipe.update({ precise: true, touchPhase: "cancelled" })).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -80 })
	).toBeNull();
});

it("rejects mouse wheels, missing precision, modified gestures and nonfinite deltas", () => {
	const swipe = new RailSpaceSwipe();
	const modifiers = { cmd: false, ctrl: false, alt: false, shift: false };

	for (const event of [
		{ precise: false, deltaX: -80 },
		{ deltaX: -80 },
		{ precise: true, deltaX: -80, modifiers: { ...modifiers, cmd: true } },
		{ precise: true, deltaX: -80, modifiers: { ...modifiers, ctrl: true } },
		{ precise: true, deltaX: -80, modifiers: { ...modifiers, alt: true } },
		{ precise: true, deltaX: -80, modifiers: { ...modifiers, shift: true } },
		{ precise: true, deltaX: Number.NaN },
		{ precise: true, deltaY: Number.POSITIVE_INFINITY },
	]) {
		expect(swipe.update({ ...event, touchPhase: "started" })).toBeNull();
		expect(
			swipe.update({ precise: true, touchPhase: "moved", deltaX: -80 })
		).toBeNull();
	}
});

it("cancels an unfinished gesture when the rail becomes disabled or is replaced", () => {
	const swipe = new RailSpaceSwipe();

	swipe.update({ precise: true, touchPhase: "started", deltaX: -30 });
	swipe.cancel();
	expect(
		swipe.update({ precise: true, touchPhase: "moved", deltaX: -60 })
	).toBeNull();
	expect(
		new RailSpaceSwipe().update({
			precise: true,
			touchPhase: "moved",
			deltaX: -80,
		})
	).toBeNull();
	expect(
		swipe.update({ precise: true, touchPhase: "started", deltaX: -60 })
	).toBe("next");
});
