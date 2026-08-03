import { Kbd } from "@1git/ui/components/kbd";
import { cn } from "@1git/ui/lib/utils";
import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	COMMAND_LENS_BACKDROP_OPACITY,
	COMMAND_LENS_GEOMETRY,
	COMMAND_LENS_Z_INDEX,
} from "@/fixture/command-lens/constants/command-lens.js";
import {
	type CommandLensHintLayout,
	type CommandLensPlacement,
	type CommandLensRect,
	getCommandLensHintRect,
} from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensCommand,
	formatCommandLensCommand,
	getCommandLensDisplayCommands,
	hasCommandLensShiftMode,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensMeasuredTarget {
	readonly commands: readonly CommandLensCommand[];
	readonly hintLayout: CommandLensHintLayout;
	readonly id: string;
	readonly placement: CommandLensPlacement;
	readonly radius: number;
	readonly rect: CommandLensRect;
}

interface CommandLensOverlayProps {
	readonly isShiftActive: boolean;
	readonly targets: readonly CommandLensMeasuredTarget[];
}

interface CommandLensHintProps {
	readonly commands: readonly CommandLensCommand[];
	readonly isShiftActive: boolean;
	readonly target: CommandLensMeasuredTarget;
}

const getMaskUrl = (id: string): string => `url(#${id})`;

function CommandLensHint({
	commands,
	isShiftActive,
	target,
}: CommandLensHintProps): ReactElement {
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentSize, setContentSize] = useState<{
		readonly height: number;
		readonly width: number;
	} | null>(null);

	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!content) {
			return;
		}
		const updateSize = (): void => {
			const rect = content.getBoundingClientRect();
			setContentSize((currentSize) => {
				if (
					currentSize?.height === rect.height &&
					currentSize.width === rect.width
				) {
					return currentSize;
				}
				return { height: rect.height, width: rect.width };
			});
		};
		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(content);
		return () => observer.disconnect();
	}, []);

	const hintRect = useMemo(() => {
		if (!contentSize) {
			return null;
		}
		return getCommandLensHintRect(
			target.rect,
			contentSize.width,
			contentSize.height,
			target.hintLayout,
			target.placement,
			{ height: window.innerHeight, width: window.innerWidth }
		);
	}, [contentSize, target.hintLayout, target.placement, target.rect]);
	const contentStyle: CSSProperties = hintRect
		? {
				left: hintRect.left,
				top: hintRect.top,
			}
		: {
				left: target.rect.left,
				top: target.rect.top,
				visibility: "hidden",
			};

	return (
		<div
			aria-hidden
			className="fixed flex h-6 w-max items-center gap-1"
			data-layout={target.hintLayout}
			data-name="CommandLensHint"
			data-shift-active={isShiftActive ? "true" : undefined}
			ref={contentRef}
			style={contentStyle}
		>
			{commands.map((command) => (
				<Kbd
					className={cn(
						"h-6 min-w-6 gap-0.5 rounded-md border-0 bg-zinc-900/90 px-1.5 font-semibold text-[10px] text-white shadow-none ring-1 ring-white/10",
						isShiftActive && "bg-zinc-700/90"
					)}
					key={`${command.key}-${command.shiftKey ? "shift" : "plain"}`}
					title={command.label}
				>
					{formatCommandLensCommand(command, isShiftActive).map((part) => (
						<span key={part}>{part}</span>
					))}
				</Kbd>
			))}
		</div>
	);
}

function CommandLensModeLegend({
	isShiftActive,
}: {
	readonly isShiftActive: boolean;
}): ReactElement {
	return (
		<div
			aria-hidden
			className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900/85 px-3 py-1.5 font-medium text-[10px] text-white/80 backdrop-blur-md"
			data-name="CommandLensModeLegend"
			data-shift-active={isShiftActive ? "true" : undefined}
		>
			<Kbd className="h-5 min-w-5 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
				⇧
			</Kbd>
			<span>
				{isShiftActive ? "Open in background" : "Hold for background"}
			</span>
		</div>
	);
}

export function CommandLensOverlay({
	isShiftActive,
	targets,
}: CommandLensOverlayProps): ReactElement {
	const maskId = useId().replaceAll(":", "");
	const presentedTargets = targets
		.map((target) => ({
			commands: getCommandLensDisplayCommands(target.commands, isShiftActive),
			target,
		}))
		.filter(({ commands }) => commands.length > 0);
	const hasShiftMode = targets.some((target) =>
		hasCommandLensShiftMode(target.commands)
	);
	const layerStyle: CSSProperties = {
		zIndex: COMMAND_LENS_Z_INDEX,
	};

	return createPortal(
		<div
			aria-hidden
			className="pointer-events-none fixed inset-0"
			data-name="CommandLensLayer"
			style={layerStyle}
		>
			<svg
				aria-hidden
				className="absolute inset-0 size-full"
				data-name="CommandLensBackdrop"
				preserveAspectRatio="none"
			>
				<title>Command Lens backdrop</title>
				<defs>
					<mask
						height="100%"
						id={maskId}
						maskContentUnits="userSpaceOnUse"
						maskUnits="userSpaceOnUse"
						width="100%"
						x="0"
						y="0"
					>
						<rect fill="white" height="100%" width="100%" />
						{presentedTargets.map(({ target }) => (
							<rect
								fill="black"
								height={
									target.rect.height + COMMAND_LENS_GEOMETRY.backdropInset * 2
								}
								key={target.id}
								rx={target.radius + COMMAND_LENS_GEOMETRY.backdropInset}
								width={
									target.rect.width + COMMAND_LENS_GEOMETRY.backdropInset * 2
								}
								x={target.rect.left - COMMAND_LENS_GEOMETRY.backdropInset}
								y={target.rect.top - COMMAND_LENS_GEOMETRY.backdropInset}
							/>
						))}
					</mask>
				</defs>
				<rect
					fill="black"
					height="100%"
					mask={getMaskUrl(maskId)}
					opacity={COMMAND_LENS_BACKDROP_OPACITY}
					width="100%"
				/>
			</svg>
			{presentedTargets.map(({ commands, target }) => (
				<CommandLensHint
					commands={commands}
					isShiftActive={isShiftActive}
					key={target.id}
					target={target}
				/>
			))}
			{hasShiftMode ? (
				<CommandLensModeLegend isShiftActive={isShiftActive} />
			) : null}
		</div>,
		document.body
	);
}
