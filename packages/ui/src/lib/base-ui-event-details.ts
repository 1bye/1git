import { createChangeEventDetails } from "@base-ui/react/internals/createBaseUIEventDetails";

export const createOutsidePressEventDetails = (
	event: PointerEvent
): ReturnType<typeof createChangeEventDetails<"outside-press">> =>
	createChangeEventDetails("outside-press", event);

export const createMenuOutsidePressEventDetails = (
	event: PointerEvent
): ReturnType<
	typeof createChangeEventDetails<
		"outside-press",
		{ preventUnmountOnClose: () => void }
	>
> =>
	createChangeEventDetails("outside-press", event, undefined, {
		preventUnmountOnClose: () => undefined,
	});
