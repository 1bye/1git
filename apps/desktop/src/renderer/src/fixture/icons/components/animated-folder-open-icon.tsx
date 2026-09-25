import type { ComponentPropsWithoutRef, ReactElement, RefObject } from "react";

import { useDwellAnimation } from "@/fixture/icons/hooks/use-dwell-animation.js";

import "../icons.css";

const FOLDER_FLAP_ANIMATION_NAME = "animated-folder-open-icon-flap";
const HOVER_DWELL_MS = 130;

const DUOTONE_BODY_PATH =
	"M69.77,112H208V88a8,8,0,0,0-8-8H128L98.13,57.6a8,8,0,0,0-4.8-1.6H40a8,8,0,0,0-8,8V208l30.18-90.53A8,8,0,0,1,69.77,112Z";
const REAR_OUTLINE_PATH =
	"M32,208V64a8,8,0,0,1,8-8H93.33a8,8,0,0,1,4.8,1.6L128,80h72a8,8,0,0,1,8,8v24";
const FRONT_FLAP_PATH =
	"M32,208l30.18-90.53A8,8,0,0,1,69.77,112H232a8,8,0,0,1,7.59,10.53L211.09,208Z";

interface AnimatedFolderOpenIconProps extends ComponentPropsWithoutRef<"svg"> {
	readonly triggerRef?: RefObject<HTMLElement | null>;
}

export function AnimatedFolderOpenIcon({
	className,
	triggerRef,
	...svgProps
}: AnimatedFolderOpenIconProps): ReactElement {
	const { iconRef, isAnimating } = useDwellAnimation({
		animationName: FOLDER_FLAP_ANIMATION_NAME,
		dwellMs: HOVER_DWELL_MS,
		triggerRef,
	});
	const iconClassName = className
		? `animated-folder-open-icon ${className}`
		: "animated-folder-open-icon";

	return (
		<svg
			fill="currentColor"
			height="1em"
			ref={iconRef}
			viewBox="0 0 256 256"
			width="1em"
			xmlns="http://www.w3.org/2000/svg"
			{...svgProps}
			className={iconClassName}
			data-animating={isAnimating ? "true" : undefined}
		>
			<title>Open folder</title>
			<rect fill="none" height="256" width="256" />
			<path d={DUOTONE_BODY_PATH} opacity="0.2" />
			<path
				d={REAR_OUTLINE_PATH}
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="16"
			/>
			<path
				className="animated-folder-open-icon__flap"
				d={FRONT_FLAP_PATH}
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="16"
			/>
		</svg>
	);
}
