import { useState } from "react";
import { Button } from "@1git/gpuix-ui/button";
import { DiffView, type DiffViewProps } from "@1git/gpuix-ui/diff-view";
import { appTokens } from "../../../styles/tokens";

/** Reviewed whole-hunk staging; the caller owns repository locking and refresh. */
export interface HunkRequest {
	action: "stage" | "unstage";
	hunkIndex: number;
	expectedPatch: string;
}

/** Keeps the full patch available and previews one hunk before an explicit write. */
export function RepositoryHunkPreview({
	action,
	onHunk,
	disabled,
	...props
}: DiffViewProps & {
	action: "stage" | "unstage";
	onHunk: (request: HunkRequest) => Promise<string | null>;
	disabled: boolean;
}) {
	const [index, setIndex] = useState(-1);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reviewedPatch, setReviewedPatch] = useState(props.patch);

	// Invalidate the review, not the native viewport, when file contents change.
	if (reviewedPatch !== props.patch) {
		setReviewedPatch(props.patch);
		setIndex(-1);
		setError(null);
	}

	const parts = props.patch.split(/(?=^@@ )/m);
	const count = parts.length - 1;
	const selected = index >= 0 && index < count;
	const busy = disabled || pending;

	const submit = async () => {
		if (busy || !selected) return;

		setPending(true);
		setError(null);

		try {
			setError(
				await onHunk({ action, hunkIndex: index, expectedPatch: props.patch })
			);
		} catch {
			setError("Could not confirm staging. Refresh before retrying.");
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: 6,
					padding: 8,
					flexShrink: 0,
				}}
			>
				<Button
					tokens={appTokens}
					size="sm"
					variant="ghost"
					disabled={busy || index <= 0}
					onPress={() => setIndex(index - 1)}
				>
					Previous
				</Button>
				<text style={{ fontSize: 11, color: appTokens.colors.textMuted }}>
					{selected
						? `Hunk ${index + 1} of ${count}`
						: `All changes · ${count} hunks`}
				</text>
				<Button
					testId="hunk-next"
					tokens={appTokens}
					size="sm"
					variant="ghost"
					disabled={busy || index + 1 >= count}
					onPress={() => setIndex(index + 1)}
				>
					{selected ? "Next" : "Review hunks"}
				</Button>
				<Button
					tokens={appTokens}
					size="sm"
					variant="ghost"
					disabled={busy || !selected}
					onPress={() => setIndex(-1)}
				>
					Show all
				</Button>
				<Button
					testId="hunk-apply"
					tokens={appTokens}
					size="sm"
					disabled={busy || !selected}
					onPress={submit}
				>
					{pending
						? "Updating…"
						: action === "stage"
							? "Stage hunk"
							: "Unstage hunk"}
				</Button>
			</div>
			{error ? (
				<text
					role="alert"
					style={{ fontSize: 11, padding: 8, color: appTokens.colors.danger }}
				>
					{error}
				</text>
			) : null}
			<DiffView
				{...props}
				onShortcut={(event) => {
					const mods = event.modifiers;

					if (event.isHeld || mods?.ctrl) return false;

					if (
						mods?.alt &&
						!mods.cmd &&
						!mods.shift &&
						(event.key === "down" || event.key === "up")
					) {
						if (!busy)
							setIndex(
								event.key === "down"
									? Math.min(count - 1, index + 1)
									: Math.max(0, index - 1)
							);

						return true;
					}

					if (mods?.cmd && mods.shift && !mods.alt && event.key === "s") {
						void submit();

						return true;
					}

					return false;
				}}
				patch={selected ? `${parts[0]}${parts[index + 1]}` : props.patch}
			/>
		</>
	);
}
