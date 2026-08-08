import { Kbd } from "@1git/ui/components/kbd";
import { cn } from "@1git/ui/lib/utils";
import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	COMMAND_LENS_BACKDROP_OPACITY,
	COMMAND_LENS_Z_INDEX,
} from "@/feature/command-lens/constants/command-lens.js";
import {
	type CommandLensHintLayout,
	type CommandLensPlacement,
	getCommandLensHintRect,
} from "@/feature/command-lens/lib/command-lens-geometry.js";
import type { CommandLensNavigationTarget } from "@/feature/command-lens/lib/command-lens-navigation.js";
import {
	type CommandLensCommand,
	commandLensAriaKeyShortcut,
	formatCommandLensCommand,
	getCommandLensDisplayCommands,
	hasCommandLensOptionMode,
} from "@/feature/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensMeasuredTarget extends CommandLensNavigationTarget {
	readonly highlightOutset: number;
	readonly hintLayout: CommandLensHintLayout;
	readonly placement: CommandLensPlacement;
	readonly radius: number;
}

interface CommandLensOverlayProps {
	readonly isOptionActive: boolean;
	readonly targets: readonly CommandLensMeasuredTarget[];
}

interface CommandLensHintProps {
	readonly commands: readonly CommandLensCommand[];
	readonly isOptionActive: boolean;
	readonly target: CommandLensMeasuredTarget;
}

const getMaskUrl = (id: string): string => `url(#${id})`;

function CommandLensHint({
	commands,
	isOptionActive,
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
			data-option-active={isOptionActive ? "true" : undefined}
			ref={contentRef}
			style={contentStyle}
		>
			{commands.map((command) => (
				<Kbd
					className={cn(
						"h-6 min-w-6 gap-0.5 rounded-md border-0 bg-zinc-900/90 px-1.5 font-semibold text-[10px] text-white shadow-none ring-1 ring-white/10",
						isOptionActive && "bg-zinc-700/90"
					)}
					key={commandLensAriaKeyShortcut(command)}
					title={command.label}
				>
					{formatCommandLensCommand(command, isOptionActive).map((part) => (
						<span key={part}>{part}</span>
					))}
				</Kbd>
			))}
		</div>
	);
}

function CommandLensModeLegend({
	isOptionActive,
}: {
	readonly isOptionActive: boolean;
}): ReactElement {
	return (
		<div
			aria-hidden
			className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900/85 px-3 py-1.5 font-medium text-[10px] text-white/80 backdrop-blur-md"
			data-name="CommandLensModeLegend"
			data-option-active={isOptionActive ? "true" : undefined}
		>
			<Kbd className="h-5 min-w-5 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
				⌥
			</Kbd>
			<span>
				{isOptionActive ? "Open in background" : "Hold for background"}
			</span>
		</div>
	);
}

export function CommandLensOverlay({
	isOptionActive,
	targets,
}: CommandLensOverlayProps): ReactElement {
	const maskId = useId().replaceAll(":", "");
	const presentedTargets = targets
		.map((target) => ({
			commands: getCommandLensDisplayCommands(target.commands, isOptionActive),
			target,
		}))
		.filter(({ commands }) => commands.length > 0);
	const hasOptionMode = hasCommandLensOptionMode(
		targets.flatMap((target) => target.commands)
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
								height={target.rect.height + target.highlightOutset * 2}
								key={target.id}
								rx={target.radius + target.highlightOutset}
								width={target.rect.width + target.highlightOutset * 2}
								x={target.rect.left - target.highlightOutset}
								y={target.rect.top - target.highlightOutset}
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
			{presentedTargets.map(({ commands, target }) =>
				commands.length > 0 ? (
					<CommandLensHint
						commands={commands}
						isOptionActive={isOptionActive}
						key={target.id}
						target={target}
					/>
				) : null
			)}
			{hasOptionMode ? (
				<CommandLensModeLegend isOptionActive={isOptionActive} />
			) : null}
		</div>,
		document.body
	);
}
