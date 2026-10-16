import { writeSync } from "node:fs";
import { RemoteFrames, remoteFrameBytes } from "./remote-protocol";
import { RemoteHelperServer } from "./remote-helper-server";

const server = new RemoteHelperServer((frame) => {
	const data = `${JSON.stringify(frame)}\n`;

	if (Buffer.byteLength(data) > remoteFrameBytes)
		throw new Error("Remote result exceeded the size limit.");

	const bytes = Buffer.from(data);
	let offset = 0;

	while (offset < bytes.length)
		offset += writeSync(1, bytes, offset, bytes.length - offset);
});

const frames = new RemoteFrames();

server.hello();

try {
	for await (const chunk of process.stdin) {
		for (const frame of frames.push(Buffer.from(chunk))) server.receive(frame);
	}
} finally {
	await server.close();
}
