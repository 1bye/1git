import type { ReactNode } from "react";
import { appTokens } from "../styles/tokens";
import { StateArtwork, type StateArtworkName } from "./state-artwork";

/** A centered illustrated message with optional recovery actions and compact list sizing. */
export function StateMessage({
	artwork,
	title,
	description,
	children,
	testId,
	role = "status",
	compact = false,
}: {
	artwork: StateArtworkName;
	title: string;
	description?: string;
	children?: ReactNode;
	testId?: string;
	role?: "status" | "alert";
	compact?: boolean;
}) {
	return (
		<div
			testId={testId}
			role={role}
			aria-label={title}
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				minWidth: 0,
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
				padding: compact ? 12 : 24,
			}}
		>
			<StateArtwork name={artwork} compact={compact} />
			<text
				role="heading"
				aria-level={2}
				style={{
					fontSize: compact ? 11 : 13,
					fontWeight: 500,
					color: appTokens.colors.text,
					textAlign: "center",
					maxWidth: 420,
				}}
			>
				{title}
			</text>
			{description ? (
				<text
					style={{
						fontSize: compact ? 10 : 11,
						color: appTokens.colors.textMuted,
						textAlign: "center",
						maxWidth: 420,
					}}
				>
					{description}
				</text>
			) : null}
			{children}
		</div>
	);
}
