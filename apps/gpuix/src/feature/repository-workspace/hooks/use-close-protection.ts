import { useGpuixRequired } from "@gpuix/react";
import { useLayoutEffect, useRef, useState } from "react";

interface ProtectedRenderer {
	setCloseBlocked(blocked: boolean): void;
	takeCloseRequested(): boolean;
}

const hasCloseProtection = (renderer: object): renderer is ProtectedRenderer =>
	"setCloseBlocked" in renderer &&
	typeof renderer.setCloseBlocked === "function" &&
	"takeCloseRequested" in renderer &&
	typeof renderer.takeCloseRequested === "function";

/** Native close veto plus a latched notice; a blocked attempt never schedules a later quit. */
export function useCloseProtection(
	busy: boolean,
	operationState: object,
	beforeRelease?: () => void
) {
	const renderer = useGpuixRequired();
	const [requested, setRequested] = useState(false);
	const armed = useRef(false);
	const native = hasCloseProtection(renderer) ? renderer : undefined;

	const block = (): void => {
		armed.current = true;
		native?.setCloseBlocked(true);
	};

	useLayoutEffect(() => {
		// TestRenderer has no OS window. The production addon is pinned by native/preload.ts.
		if (!native) return;

		if (busy) {
			armed.current = true;
			native.setCloseBlocked(true);
		} else if (armed.current) {
			// AppKit may terminate without JS exit handlers. Flush completed drafts first.
			beforeRelease?.();
			armed.current = false;
			native.setCloseBlocked(false);
		}

		const check = (): void => {
			if (native.takeCloseRequested()) setRequested(true);
		};

		check();

		if (!busy) return;

		const timer = setInterval(check, 100);

		return () => clearInterval(timer);
	}, [busy, native, operationState, beforeRelease]);

	return { block, requested, dismiss: () => setRequested(false) };
}
