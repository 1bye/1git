import { useLayoutEffect, useState, type RefObject } from "react";
import type { PublicInstance } from "@gpuix/react";
import type { UiTokens } from "./tokens";

/** Optional scrollbars painted and operated alongside their native scroll handles. */
export function Scrollbars({
	vertical,
	horizontal,
	tokens,
	testId = "scrollbar",
}: {
	vertical: RefObject<PublicInstance | null>;
	horizontal?: RefObject<PublicInstance | null>;
	tokens: UiTokens;
	testId?: string;
}) {
	if (!tokens.showScrollbars) return null;

	return (
		<>
			<Scrollbar
				target={vertical}
				horizontal={false}
				corner={!!horizontal}
				tokens={tokens}
				testId={`${testId}-vertical`}
			/>
			{horizontal ? (
				<Scrollbar
					target={horizontal}
					horizontal
					corner
					tokens={tokens}
					testId={`${testId}-horizontal`}
				/>
			) : null}
		</>
	);
}

function Scrollbar({
	target,
	horizontal,
	corner,
	tokens,
	testId,
}: {
	target: RefObject<PublicInstance | null>;
	horizontal: boolean;
	corner: boolean;
	tokens: UiTokens;
	testId: string;
}) {
	const [targetId, setTargetId] = useState<number>();

	useLayoutEffect(() => {
		setTargetId(target.current?.id);
	}, [target]);

	if (targetId === undefined) return null;

	return (
		<div
			testId={testId}
			role="scrollbar"
			aria-label={horizontal ? "Horizontal scroll" : "Vertical scroll"}
			aria-orientation={horizontal ? "horizontal" : "vertical"}
			tabIndex={0}
			nativeScrollbar={{ targetId, horizontal, corner }}
			style={{
				position: "absolute",
				width: 0,
				height: 0,
				color: tokens.colors.textMuted,
			}}
		/>
	);
}
