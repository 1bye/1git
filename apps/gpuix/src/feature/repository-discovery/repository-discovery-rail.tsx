import { useState } from "react";
import { useWindowSize } from "@gpuix/react";
import { useAppTheme } from "../../styles/theme";

/** Indeterminate, native-animated page rail; discovering folders has no meaningful percentage. */
export function RepositoryDiscoveryRail({ count }: { count: number }) {
	const { colors } = useAppTheme();
	const { width } = useWindowSize();
	const [cycle, setCycle] = useState(0);
	const segmentWidth = Math.max(80, width / 4);

	return (
		<div
			testId="discovery-rail"
			role="progressbar"
			aria-label={`Scanning for repositories. ${count} found.`}
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: 2,
				overflow: "hidden",
				pointerEvents: "none",
			}}
		>
			<div
				testId="discovery-rail-segment"
				key={`${width}:${cycle}`}
				motion={{
					initial: { left: -segmentWidth },
					animate: { left: width },
					transition: { duration: 1.4, ease: "linear" },
				}}
				onMotionComplete={() => setCycle((value) => value + 1)}
				style={{
					position: "absolute",
					top: 0,
					width: segmentWidth,
					height: 2,
					backgroundColor: colors.brand,
					pointerEvents: "none",
				}}
			/>
		</div>
	);
}
