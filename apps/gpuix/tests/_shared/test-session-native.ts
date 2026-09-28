import { TestGpuixRenderer } from "@gpuix/native";

const disposeCurrent: unknown = Reflect.get(
	TestGpuixRenderer,
	"disposeCurrent"
);

if (typeof disposeCurrent !== "function") {
	throw new Error("Missing native test-session teardown patch");
}

for (let index = 0; index < 60; index++) {
	const renderer = new TestGpuixRenderer(800, 600);

	renderer.applyBatch(
		JSON.stringify([
			["createElement", 1, "div"],
			["setRoot", 1],
		])
	);
	renderer.flush();

	if (index === 29) {
		disposeCurrent();
		disposeCurrent();
	}
}

if (process.argv[2] === "inspect") {
	disposeCurrent();
	disposeCurrent();
	process.stdout.write("Session disposed\n");
	// Keep the process alive for the parent to inspect the heap, not for cleanup.
	await Bun.stdin.text();
}
