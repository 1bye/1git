import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";
import { Text } from "@1git/gpuix-ui/text";
import { StyleSheet } from "@1git/gpuix-stylesheet";
import { useState } from "react";

const styles = StyleSheet.create({
	root: {
		display: "flex",
		flexDirection: "column",
		gap: 28,
		padding: 40,
		width: "100%",
		height: "100%",
		backgroundColor: "#161618",
	},
	section: {
		display: "flex",
		flexDirection: "column",
		gap: 12,
		alignItems: "start",
	},
	row: { display: "flex", alignItems: "center", gap: 12 },
});

/** A small interactive showcase of the native UI package. */
export function App() {
	const [presses, setPresses] = useState(0);
	const [branch, setBranch] = useState("main");

	return (
		<div style={styles.root}>
			<div style={styles.section}>
				<Text size="lg" weight="semibold">
					GPUIX UI
				</Text>
				<Text tone="muted">Native components for 1git</Text>
			</div>
			<div style={styles.section}>
				<Text weight="medium">Buttons</Text>
				<div style={styles.row}>
					<Button
						testId="primary-button"
						onPress={() => setPresses((value) => value + 1)}
					>
						Primary
					</Button>
					<Button
						variant="secondary"
						onPress={() => setPresses((value) => value + 1)}
					>
						Secondary
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onPress={() => setPresses((value) => value + 1)}
					>
						Ghost
					</Button>
					<Button disabled>Disabled</Button>
				</div>
				<Text size="sm" tone="muted">
					Activated {presses} times. Try Tab, Enter, and Space.
				</Text>
			</div>
			<div style={styles.section}>
				<Text weight="medium">Select</Text>
				<Select value={branch} onValueChange={setBranch}>
					<SelectTrigger testId="branch-trigger" aria-label="Branch">
						<SelectValue placeholder="Choose a branch" />
					</SelectTrigger>
					<SelectContent testId="branch-content">
						<SelectItem value="main">main</SelectItem>
						<SelectItem value="develop">develop</SelectItem>
						<SelectItem value="archived" disabled>
							archived
						</SelectItem>
					</SelectContent>
				</Select>
				<Text size="sm" tone="muted">
					Selected branch: {branch}
				</Text>
			</div>
		</div>
	);
}
