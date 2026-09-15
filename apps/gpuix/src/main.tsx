import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createTestRoot, render } from "@gpuix/react";
import { RepositoryApp } from "./app";
import { loadRepositoryView, openRepository, parseCliArguments } from "./model";

const WINDOW_OPTIONS = {
	height: 820,
	minHeight: 640,
	minWidth: 980,
	title: "1git · GPUix",
	titlebarTransparent: true,
	trafficLightX: 16,
	trafficLightY: 17,
	width: 1280,
	windowBackground: "opaque",
} as const;

const run = async (): Promise<void> => {
	const options = parseCliArguments(process.argv.slice(2), process.cwd());
	const repository = await openRepository(options.repositoryPath);
	const initialView = await loadRepositoryView(repository, null);
	const application = (
		<RepositoryApp initialView={initialView} repository={repository} />
	);

	if (options.screenshotPath) {
		await mkdir(dirname(options.screenshotPath), { recursive: true });
		const testRoot = createTestRoot();
		testRoot.render(application);
		testRoot.renderer.flush();
		testRoot.renderer.captureScreenshot(options.screenshotPath);
		testRoot.unmount();
		return;
	}

	render(application, WINDOW_OPTIONS);
};

try {
	await run();
} catch (error: unknown) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
}
