import { useEffect, useState } from "react";
import { controlSize, fontWeight, typography } from "@1git/design-tokens";
import type { GitTransferProgress } from "@1git/git";

const phaseLabels = {
	connecting: "Connecting…",
	counting: "Counting objects",
	compressing: "Compressing objects",
	sending: "Sending objects",
	receiving: "Receiving objects",
	resolving: "Resolving deltas",
	confirming: "Waiting for remote confirmation…",
	refreshing: "Refreshing repository status…",
};

/** A transfer reaching 100% is not confirmation that the remote accepted the write. */
export function syncProgressLabel(progress: GitTransferProgress): string {
	if (progress.percent === 100 && progress.phase === "sending")
		return phaseLabels.confirming;

	return `${phaseLabels[progress.phase]}${progress.percent === null ? "" : ` — ${progress.percent}%`}`;
}

const gaugeStart = (135 * Math.PI) / 180;
const gaugeSweep = (270 * Math.PI) / 180;

function gaugeSource(fraction: number, offset = 0): string {
	const point = (position: number) => {
		const angle = gaugeStart + position * gaugeSweep;

		return `${(16 + 10 * Math.cos(angle)).toFixed(2)} ${(12 + 10 * Math.sin(angle)).toFixed(2)}`;
	};

	const arc = (start: number, length: number) =>
		`M${point(start)} A10 10 0 ${length * gaugeSweep > Math.PI ? 1 : 0} 1 ${point(start + length)}`;

	const fill = fraction > 0 ? `<path d="${arc(offset, fraction)}"/>` : "";

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="${arc(0, 1)}" opacity=".18"/>${fill}</svg>`;
}

// Move a segment back and forth within a stationary track, reusing bounded native SVG masks.
const spinnerFrames = Array.from({ length: 60 }, (_, frame) =>
	gaugeSource(0.24, 0.38 * (1 - Math.cos((frame * 2 * Math.PI) / 60)))
);

/** Phase-local transfer gauge, with a bottom percentage; 100% still waits for Git's confirmed result. */
export function RepositorySyncProgress({
	progress,
	color,
}: {
	progress?: GitTransferProgress;
	color: string;
}) {
	const value = progress ?? { phase: "connecting", percent: null };

	const percent =
		value.percent !== null &&
		(value.phase === "sending" || value.phase === "receiving")
			? Math.min(100, Math.max(0, value.percent))
			: null;

	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (percent !== null) return;

		const timer = setInterval(
			() => setFrame((current) => (current + 1) % spinnerFrames.length),
			1000 / 60
		);

		return () => clearInterval(timer);
	}, [percent]);

	const label = syncProgressLabel(value);

	return (
		<div
			testId="rail-sync-progress"
			role="progressbar"
			aria-label="Repository synchronization"
			aria-valuetext={label}
			style={{
				position: "relative",
				width: controlSize.rail,
				height: controlSize.rail,
				flexShrink: 0,
				color,
				pointerEvents: "none",
			}}
		>
			<svg
				testId="rail-sync-progress-gauge"
				aria-hidden={true}
				source={
					percent === null ? spinnerFrames[frame] : gaugeSource(percent / 100)
				}
				style={{ width: controlSize.rail, height: controlSize.rail, color }}
			/>
			<text
				testId="rail-sync-progress-label"
				aria-hidden={true}
				style={{
					...typography["2xs"],
					fontWeight: fontWeight.medium,
					position: "absolute",
					left: 0,
					bottom: 0,
					width: controlSize.rail,
					height: typography["2xs"].lineHeight,
					textAlign: "center",
					whiteSpace: "nowrap",
					color,
				}}
			>
				{percent === null ? "…" : `${percent}%`}
			</text>
		</div>
	);
}
