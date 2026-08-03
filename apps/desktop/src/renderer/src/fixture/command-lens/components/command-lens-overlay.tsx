import { Kbd } from "@1git/ui/components/kbd";
import { cn } from "@1git/ui/lib/utils";
import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	COMMAND_LENS_BACKDROP_OPACITY,
	COMMAND_LENS_Z_INDEX,
} from "@/fixture/command-lens/constants/command-lens.js";
import {
	type CommandLensHintLayout,
	type CommandLensPlacement,
	getCommandLensHintRect,
} from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensNavigationTarget,
	getCommandLensNavigationAction,
} from "@/fixture/command-lens/lib/command-lens-navigation.js";
import {
	type CommandLensCommand,
	commandLensAriaKeyShortcut,
	formatCommandLensCommand,
	getCommandLensDisplayCommands,
	hasCommandLensOptionMode,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensMeasuredTarget extends CommandLensNavigationTarget {
	readonly highlightOutset: number;
	readonly hintLayout: CommandLensHintLayout;
	readonly placement: CommandLensPlacement;
	readonly radius: number;
}

interface CommandLensOverlayProps {
	readonly isNavigationActive: boolean;
	readonly isOptionActive: boolean;
	readonly selectedTargetId: string | null;
	readonly targets: readonly CommandLensMeasuredTarget[];
}

interface CommandLensHintProps {
	readonly commands: readonly CommandLensCommand[];
	readonly isNavigationActive: boolean;
	readonly isOptionActive: boolean;
	readonly isSelected: boolean;
	readonly target: CommandLensMeasuredTarget;
}

const getMaskUrl = (id: string): string => `url(#${id})`;

function CommandLensHint({
	commands,
	isNavigationActive,
	isOptionActive,
	isSelected,
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
			className={cn(
				"fixed flex h-6 w-max items-center gap-1",
				isNavigationActive && !isSelected && "scale-[0.96] opacity-20",
				isNavigationActive && isSelected && "z-[1]"
			)}
			data-layout={target.hintLayout}
			data-name="CommandLensHint"
			data-navigation-active={isNavigationActive ? "true" : undefined}
			data-option-active={isOptionActive ? "true" : undefined}
			data-selected={isSelected ? "true" : undefined}
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

function CommandLensSelection({
	target,
}: {
	readonly target: CommandLensMeasuredTarget;
}): ReactElement {
	const outset = target.highlightOutset;
	const selectionStyle: CSSProperties = {
		borderRadius: target.radius + outset,
		height: target.rect.height + outset * 2,
		left: target.rect.left - outset,
		top: target.rect.top - outset,
		width: target.rect.width + outset * 2,
	};
	return (
		<div
			aria-hidden
			className="fixed bg-white/15 ring-1 ring-zinc-900/20"
			data-name="CommandLensSelection"
			style={selectionStyle}
		/>
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

function CommandLensNavigationLegend({
	hasAlternateActions,
	isOptionActive,
}: {
	readonly hasAlternateActions: boolean;
	readonly isOptionActive: boolean;
}): ReactElement {
	return (
		<div
			aria-hidden
			className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900/88 px-3 py-1.5 font-medium text-[10px] text-white/75 backdrop-blur-md"
			data-name="CommandLensNavigationLegend"
		>
			<span className="flex items-center gap-1.5">
				<Kbd className="h-5 min-w-8 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
					↑↓
				</Kbd>
				Move
			</span>
			<span className="flex items-center gap-1.5">
				<Kbd className="h-5 min-w-8 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
					←→
				</Kbd>
				Section
			</span>
			<span className="flex items-center gap-1.5">
				<Kbd className="h-5 min-w-5 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
					↵
				</Kbd>
				Run
			</span>
			{hasAlternateActions ? (
				<span
					className={cn(
						"flex items-center gap-1.5",
						isOptionActive && "text-white"
					)}
				>
					<Kbd className="h-5 min-w-5 rounded-md bg-white/15 px-1 text-[10px] text-white shadow-none">
						⌥
					</Kbd>
					Alternate
				</span>
			) : null}
		</div>
	);
}

export function CommandLensOverlay({
	isNavigationActive,
	isOptionActive,
	selectedTargetId,
	targets,
}: CommandLensOverlayProps): ReactElement {
	const maskId = useId().replaceAll(":", "");
	const presentedTargets = targets
		.map((target) => ({
			commands: getCommandLensDisplayCommands(target.commands, isOptionActive),
			target,
		}))
		.filter(({ commands, target }) =>
			isNavigationActive
				? getCommandLensNavigationAction(target, isOptionActive) !== null
				: commands.length > 0
		);
	const selectedPresentation = presentedTargets.find(
		({ target }) => target.id === selectedTargetId
	);
	const selectedTarget = selectedPresentation?.target;
	const maskTargets = selectedPresentation
		? [
				...presentedTargets.filter(
					({ target }) => target.id !== selectedPresentation.target.id
				),
				selectedPresentation,
			]
		: presentedTargets;
	const hasOptionMode = hasCommandLensOptionMode(
		targets.flatMap((target) => target.commands)
	);
	const hasAlternateActions = targets.some(
		(target) => target.navigationAlternateAction
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
						{maskTargets.map(({ target }) => (
							<rect
								fill={
									isNavigationActive && target.id !== selectedTargetId
										? "#777"
										: "black"
								}
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
			{selectedTarget ? <CommandLensSelection target={selectedTarget} /> : null}
			{presentedTargets.map(({ commands, target }) =>
				commands.length > 0 ? (
					<CommandLensHint
						commands={commands}
						isNavigationActive={isNavigationActive}
						isOptionActive={isOptionActive}
						isSelected={target.id === selectedTargetId}
						key={target.id}
						target={target}
					/>
				) : null
			)}
			{isNavigationActive ? (
				<CommandLensNavigationLegend
					hasAlternateActions={hasAlternateActions}
					isOptionActive={isOptionActive}
				/>
			) : null}
			{!isNavigationActive && hasOptionMode ? (
				<CommandLensModeLegend isOptionActive={isOptionActive} />
			) : null}
		</div>,
		document.body
	);
}
