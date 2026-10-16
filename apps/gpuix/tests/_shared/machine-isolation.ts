import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The native UI suite must never load a developer's saved SSH machines.
const directory = mkdtempSync(join(tmpdir(), "1git-test-machines-"));

process.env.GPUIX_MACHINES_PATH = join(directory, "machines.json");
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
