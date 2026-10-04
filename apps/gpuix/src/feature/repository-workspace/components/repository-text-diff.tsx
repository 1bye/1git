import { DiffView } from "@1git/gpuix-ui/diff-view";
import type { GpuixTheme } from "@gpuix/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { appTokens } from "../../../styles/tokens";
import { DiffContext } from "../lib/diff-context";
import { RepositoryDiff, type DiffSelection } from "../lib/repository-diff";

/** Owns one displayed snapshot's on-demand context; never replaces the diff with a loader. */
export function RepositoryTextDiff({
	root,
	change,
	snapshot,
	patch,
	theme,
	blocked,
}: {
	root: string;
	change: DiffSelection;
	snapshot: object;
	patch: string;
	theme: GpuixTheme;
	blocked: boolean;
}) {
	const [expanded, setExpanded] = useState({ snapshot, patch });

	const [failure, setFailure] = useState<{
		snapshot: object;
		message: string;
	} | null>(null);

	const pending = useRef<AbortController | null>(null);
	const displayed = expanded.snapshot === snapshot ? expanded.patch : patch;
	const error = failure?.snapshot === snapshot ? failure.message : null;

	// Reset only context, not the native viewport, so status refresh preserves scroll.
	useLayoutEffect(
		() => () => {
			pending.current?.abort();
			pending.current = null;
		},
		[snapshot]
	);
	useEffect(() => {
		if (blocked) {
			pending.current?.abort();
			pending.current = null;
		}
	}, [blocked]);

	const expand = async (oldLine?: number, newLine?: number): Promise<void> => {
		if (blocked || pending.current) return;

		const controller = new AbortController();

		pending.current = controller;
		setFailure(null);

		try {
			const request = DiffContext.request(displayed, oldLine, newLine);

			if (!request) return;

			const source = await RepositoryDiff.readContext(
				root,
				change,
				request.contextLines,
				controller.signal
			);

			if (!controller.signal.aborted)
				setExpanded({
					snapshot,
					patch: DiffContext.expand(displayed, source, request),
				});
		} catch (cause) {
			if (!controller.signal.aborted)
				setFailure({
					snapshot,
					message:
						cause instanceof Error
							? cause.message
							: "Unable to expand diff context.",
				});
		} finally {
			if (pending.current === controller) pending.current = null;
		}
	};

	return (
		<>
			<DiffView
				testId="diff-viewport"
				patch={displayed}
				showFileHeader={false}
				focusVisible={false}
				theme={theme}
				tokens={appTokens}
				aria-label={"commit" in change ? "Committed file diff" : "File diff"}
				aria-description="Read-only. Use arrows, Page Up, Page Down, Home and End to scroll. Press E to expand 20 unchanged lines at the first remaining separator. Select text and press Command C to copy."
				onExpandContext={(event) => {
					void expand(event.oldLine, event.newLine);
				}}
				onShortcut={(event) => {
					if (
						event.key !== "e" ||
						event.modifiers?.cmd ||
						event.modifiers?.ctrl ||
						event.modifiers?.alt
					)
						return false;

					void expand();

					return true;
				}}
			/>
			{error ? (
				<text
					testId="diff-context-status"
					role="alert"
					style={{
						flexShrink: 0,
						paddingLeft: 14,
						paddingRight: 14,
						paddingTop: 6,
						paddingBottom: 6,
						fontSize: 11,
						color: appTokens.colors.danger,
					}}
				>
					{error}
				</text>
			) : null}
		</>
	);
}
