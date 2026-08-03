import { Kbd } from "@1git/ui/components/kbd";
import type { CSSProperties, ReactElement } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	COMMAND_LENS_BACKDROP_OPACITY,
	COMMAND_LENS_GEOMETRY,
	COMMAND_LENS_Z_INDEX,
} from "@/fixture/command-lens/constants/command-lens.js";
import {
	type CommandLensPlacement,
	type CommandLensRect,
	createCommandLensSurfaceFrame,
	getCommandLensHintRect,
} from "@/fixture/command-lens/lib/command-lens-geometry.js";
import {
	type CommandLensCommand,
	formatCommandLensCommand,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensMeasuredTarget {
	readonly commands: readonly CommandLensCommand[];
	readonly id: string;
	readonly placement: CommandLensPlacement;
	readonly radius: number;
	readonly rect: CommandLensRect;
}

interface CommandLensOverlayProps {
	readonly targets: readonly CommandLensMeasuredTarget[];
}

interface CommandLensHintProps {
	readonly target: CommandLensMeasuredTarget;
}

const getMaskUrl = (id: string): string => `url(#${id})`;

function CommandLensHint({
	target,
}: CommandLensHintProps): ReactElement | null {
	const maskId = useId().replaceAll(":", "");
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
			target.placement,
			{ height: window.innerHeight, width: window.innerWidth }
		);
	}, [contentSize, target.placement, target.rect]);
	const frame = useMemo(
		() =>
			hintRect
				? createCommandLensSurfaceFrame(target.rect, hintRect, target.radius)
				: null,
		[hintRect, target.radius, target.rect]
	);
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
	const surfaceStyle: CSSProperties | undefined = frame
		? {
				height: frame.bounds.height,
				left: frame.bounds.left,
				top: frame.bounds.top,
				width: frame.bounds.width,
			}
		: undefined;

	return (
		<>
			{frame ? (
				<svg
					aria-hidden
					className="fixed overflow-visible"
					data-name="CommandLensHintSurface"
					preserveAspectRatio="none"
					style={surfaceStyle}
					viewBox={`0 0 ${frame.bounds.width} ${frame.bounds.height}`}
				>
					<title>Shortcut hint surface</title>
					<defs>
						<mask
							height={frame.bounds.height}
							id={maskId}
							maskContentUnits="userSpaceOnUse"
							maskUnits="userSpaceOnUse"
							width={frame.bounds.width}
							x="0"
							y="0"
						>
							<rect
								fill="white"
								height={frame.bounds.height}
								width={frame.bounds.width}
							/>
							<rect
								fill="black"
								height={frame.anchor.height}
								rx={target.radius}
								width={frame.anchor.width}
								x={frame.anchor.left}
								y={frame.anchor.top}
							/>
						</mask>
					</defs>
					<path
						d={frame.path}
						data-name="CommandLensHintSurfaceFill"
						mask={getMaskUrl(maskId)}
					/>
					<path
						d={frame.path}
						data-name="CommandLensHintSurfaceOutline"
						fill="none"
						strokeLinejoin="round"
						strokeWidth="1"
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
			) : null}
			<div
				aria-hidden
				className="fixed flex h-7 w-max items-center gap-1.5 px-2"
				data-name="CommandLensHint"
				ref={contentRef}
				style={contentStyle}
			>
				{target.commands.map((command) => (
					<Kbd
						className="gap-0.5 border-0 bg-black/5 px-1.5 text-[10px] text-editor-muted shadow-none"
						key={`${command.key}-${command.shiftKey ? "shift" : "plain"}`}
						title={command.label}
					>
						{formatCommandLensCommand(command).map((part) => (
							<span key={part}>{part}</span>
						))}
					</Kbd>
				))}
			</div>
		</>
	);
}

export function CommandLensOverlay({
	targets,
}: CommandLensOverlayProps): ReactElement {
	const maskId = useId().replaceAll(":", "");
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
						{targets.map((target) => (
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
			{targets.map((target) => (
				<CommandLensHint key={target.id} target={target} />
			))}
		</div>,
		document.body
	);
}
