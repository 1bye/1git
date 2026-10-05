import { spacing, typography, lightColors } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";

import { appTokens } from "../../../styles/tokens";

/** Compact, keyboard-accessible retry/pagination control without replacing loaded rows. */
export function RepositoryReadNotice({
	testId,
	loading,
	error,
	onPress,
	label,
}: {
	testId: string;
	loading: boolean;
	error?: string | null;
	onPress: () => void;
	label: string;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				paddingLeft: spacing[2.5],
				paddingRight: spacing[2.5],
				paddingBottom: spacing[1],
				flexShrink: 0,
				gap: spacing[1],
			}}
		>
			{error ? (
				<text
					role="alert"
					style={{ ...typography.xs, color: lightColors.editorMuted }}
				>
					{error}
				</text>
			) : null}
			<Button
				testId={testId}
				tokens={appTokens}
				size="sm"
				variant="ghost"
				disabled={loading}
				onPress={onPress}
			>
				{loading ? "Loading…" : error ? "Retry" : label}
			</Button>
		</div>
	);
}
