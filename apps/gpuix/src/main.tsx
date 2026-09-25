import { StyleSheet } from "@1git/gpuix-stylesheet";
import { render } from "@gpuix/react";

const styles = StyleSheet.create({
	root: {
		height: "100%",
		width: "100%",
	},
});

render(<div style={styles.root} />, {
	focus: process.env.GPUIX_BACKGROUND !== "1",
	height: 820,
	title: "1git",
	width: 1280,
});
