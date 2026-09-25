import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";
import { Text } from "@1git/gpuix-ui/text";
import { defaultTokens, type UiTokens } from "@1git/gpuix-ui/tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { useState } from "react";

const styles = StyleSheet.create({
	root: ({ colors, layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		gap: layout.sectionGap,
		padding: layout.pagePadding,
		width: "100%",
		height: "100%",
		backgroundColor: colors.background,
	}),
	section: ({ layout }: UiTokens) => ({
		display: "flex",
		flexDirection: "column",
		gap: layout.contentGap,
		alignItems: "start",
	}),
	row: ({ layout }: UiTokens) => ({
		display: "flex",
		alignItems: "center",
		gap: layout.contentGap,
	}),
});

/** A small interactive showcase of the native UI package. */
export function App({ tokens = defaultTokens }: { tokens?: UiTokens }) {
	const [presses, setPresses] = useState(0);
	const [branch, setBranch] = useState("main");

	return (
		<div style={styles.root(tokens)}>
			<div style={styles.section(tokens)}>
				<Text tokens={tokens} size="lg" weight="semibold">
					GPUIX UI
				</Text>
				<Text tokens={tokens} tone="muted">
					Native components for 1git
				</Text>
			</div>
			<div style={styles.section(tokens)}>
				<Text tokens={tokens} weight="medium">
					Buttons
				</Text>
				<div style={styles.row(tokens)}>
					<Button
						tokens={tokens}
						testId="primary-button"
						onPress={() => setPresses((value) => value + 1)}
					>
						Primary
					</Button>
					<Button
						tokens={tokens}
						variant="secondary"
						onPress={() => setPresses((value) => value + 1)}
					>
						Secondary
					</Button>
					<Button
						tokens={tokens}
						variant="ghost"
						size="sm"
						onPress={() => setPresses((value) => value + 1)}
					>
						Ghost
					</Button>
					<Button tokens={tokens} disabled>
						Disabled
					</Button>
				</div>
				<Text tokens={tokens} size="sm" tone="muted">
					Activated {presses} times. Try Tab, Enter, and Space.
				</Text>
			</div>
			<div style={styles.section(tokens)}>
				<Text tokens={tokens} weight="medium">
					Select
				</Text>
				<Select value={branch} onValueChange={setBranch}>
					<SelectTrigger
						tokens={tokens}
						testId="branch-trigger"
						aria-label="Branch"
					>
						<SelectValue tokens={tokens} placeholder="Choose a branch" />
					</SelectTrigger>
					<SelectContent tokens={tokens} testId="branch-content">
						<SelectItem tokens={tokens} value="main">
							main
						</SelectItem>
						<SelectItem tokens={tokens} value="develop">
							develop
						</SelectItem>
						<SelectItem tokens={tokens} value="archived" disabled>
							archived
						</SelectItem>
					</SelectContent>
				</Select>
				<Text tokens={tokens} size="sm" tone="muted">
					Selected branch: {branch}
				</Text>
			</div>
		</div>
	);
}
