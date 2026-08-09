interface WorkspaceTabScrollInput {
	readonly currentScrollLeft: number;
	readonly maximumScrollLeft: number;
	readonly tabLeft: number;
	readonly tabRight: number;
	readonly viewportLeft: number;
	readonly viewportRight: number;
}

const clampScrollLeft = (value: number, maximum: number): number =>
	Math.max(0, Math.min(value, Math.max(0, maximum)));

export const getWorkspaceTabRevealScrollLeft = ({
	currentScrollLeft,
	maximumScrollLeft,
	tabLeft,
	tabRight,
	viewportLeft,
	viewportRight,
}: WorkspaceTabScrollInput): number => {
	let scrollDelta = 0;
	if (tabLeft < viewportLeft) {
		scrollDelta = tabLeft - viewportLeft;
	} else if (tabRight > viewportRight) {
		scrollDelta = tabRight - viewportRight;
	}
	return clampScrollLeft(currentScrollLeft + scrollDelta, maximumScrollLeft);
};
