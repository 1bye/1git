export interface LiquidMenuAnchorPresentation {
	readonly isActive: boolean;
	readonly isPromoted: boolean;
}

interface LiquidMenuAnchorPresentationOptions {
	readonly hasSurface: boolean;
	readonly isObscured: boolean;
	readonly isOpen: boolean;
}

export const getLiquidMenuAnchorPresentation = ({
	hasSurface,
	isObscured,
	isOpen,
}: LiquidMenuAnchorPresentationOptions): LiquidMenuAnchorPresentation => {
	const isActive = isOpen || hasSurface;
	return {
		isActive,
		isPromoted: isActive && !isObscured,
	};
};
