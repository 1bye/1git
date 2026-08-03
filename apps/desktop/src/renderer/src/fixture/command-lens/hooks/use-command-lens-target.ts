import type { RefCallback } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
	type CommandLensTargetOptions,
	useCommandLensContext,
} from "@/fixture/command-lens/hooks/use-command-lens-context.js";
import {
	commandLensAriaKeyShortcut,
	commandLensCommandSignature,
} from "@/fixture/command-lens/lib/command-lens-shortcut.js";

export interface CommandLensTargetRegistration {
	readonly ariaKeyShortcuts: string | undefined;
	readonly ref: RefCallback<HTMLElement>;
}

export const useCommandLensTarget = (
	options: CommandLensTargetOptions
): CommandLensTargetRegistration => {
	const context = useCommandLensContext();
	const elementRef = useRef<HTMLElement | null>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const targetRevision = [
		options.disabled ? "disabled" : "enabled",
		String(options.highlightInsetBlock ?? 0),
		String(options.highlightInsetInline ?? 0),
		String(options.highlightOutset ?? 2),
		options.hintLayout ?? "floating",
		options.navigationAction
			? `${options.navigationAction.label}:${options.navigationAction.hintLabel ?? ""}:${options.navigationAction.advanceSelection ?? "stay"}`
			: "derived-primary",
		options.navigationAlternateAction
			? `${options.navigationAlternateAction.label}:${options.navigationAlternateAction.hintLabel ?? ""}:${options.navigationAlternateAction.advanceSelection ?? "stay"}`
			: "derived-alternate",
		options.navigationDefault ? "default" : "standard",
		options.navigationGroup ?? options.id,
		String(options.navigationOrder ?? 0),
		options.navigationOrientation ?? "vertical",
		options.placement ?? "bottom",
		String(options.radius ?? 12),
		commandLensCommandSignature(options.commands),
	].join(":");

	const setElement = useCallback(
		(element: HTMLElement | null): void => {
			elementRef.current = element;
			context.requestMeasurement();
		},
		[context.requestMeasurement]
	);

	useLayoutEffect(
		() =>
			context.registerTarget(options.id, () => ({
				...optionsRef.current,
				element: elementRef.current,
			})),
		[context.registerTarget, options.id]
	);
	useLayoutEffect(() => {
		context.refreshTarget(options.id, targetRevision);
	}, [context.refreshTarget, options.id, targetRevision]);

	const ariaKeyShortcuts =
		options.disabled || options.commands.length === 0
			? undefined
			: options.commands.map(commandLensAriaKeyShortcut).join(" ");

	return {
		ariaKeyShortcuts,
		ref: setElement,
	};
};
