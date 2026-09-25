interface ConstrainedMenuAlignOffsetInput {
	readonly anchorLeft: number;
	readonly anchorWidth: number;
	readonly inlineInset: number;
	readonly menuWidth: number;
	readonly pointerClientX: number | null;
}

interface ContextMenuPointerInput {
	readonly clientX: number;
	readonly clientY: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(Math.max(value, minimum), maximum);

export const getContextMenuPointerClientX = ({
	clientX,
	clientY,
}: ContextMenuPointerInput): number | null =>
	clientX === 0 && clientY === 0 ? null : clientX;

export const getConstrainedMenuAlignOffset = ({
	anchorLeft,
	anchorWidth,
	inlineInset,
	menuWidth,
	pointerClientX,
}: ConstrainedMenuAlignOffsetInput): number => {
	const minimumLeft = anchorLeft + inlineInset;

	const maximumLeft = Math.max(
		minimumLeft,
		anchorLeft + anchorWidth - menuWidth - inlineInset
	);

	const preferredLeft =
		pointerClientX === null
			? anchorLeft + (anchorWidth - menuWidth) / 2
			: pointerClientX - menuWidth / 2;

	return clamp(preferredLeft, minimumLeft, maximumLeft) - anchorLeft;
};
