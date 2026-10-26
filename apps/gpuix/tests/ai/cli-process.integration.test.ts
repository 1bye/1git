/**
 * Covers: shell-free stdin, CLI protocols, safety flags, defaults, errors, limits and process-group cancellation.
 * Real: Bun child processes, CLI adapter and disposable files.
 * Doubles: agent executables and an injected stdin-write failure; no model calls or actual credentials.
 * Requires: Bun on macOS or Linux; writable temporary storage.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliAgent } from "../../src/feature/ai/lib/cli-agent";
import {
	emptyAiPreferences,
	type AiPreferences,
} from "../../src/feature/ai/lib/ai-settings-store";

let directory: string;
let record: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "1git-agent-process-"));
	record = join(directory, "request.json");
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

async function fixture(
	source: string,
	provider: "claude-code" | "codex" = "claude-code",
	levels: readonly string[] = ["low", "medium", "high", "xhigh", "max"]
): Promise<AiPreferences> {
	const executable = join(directory, "agent with spaces");

	await writeFile(
		executable,
		`#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.includes("--version")) { console.info("fixture CLI 1.0"); process.exit(0); }
if (args[0] === "mcp") { console.info(JSON.stringify([{name:"example-server",enabled:true,transport:{type:"stdio"}}])); process.exit(0); }
if (args[0] === "app-server" || args.includes("--input-format")) {
 const { createInterface } = await import("node:readline");
 const levels = ${JSON.stringify(levels)};
 for await (const line of createInterface({input:process.stdin})) {
  const request = JSON.parse(line);
  if (request.type === "control_request") console.info(JSON.stringify({type:"control_response",response:{subtype:"success",request_id:request.request_id,response:{models:[{value:"test-model",displayName:"Test",supportsEffort:true,supportedEffortLevels:levels}]}}}));
  if (request.method === "initialize") console.info(JSON.stringify({id:request.id,result:{}}));
  if (request.method === "model/list") console.info(JSON.stringify({id:request.id,result:{data:[{model:"test-model",supportedReasoningEfforts:levels.map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:"high"}],nextCursor:null}}));
 }
 process.exit(0);
}
const input = await Bun.stdin.text();
const capture = { args, input, cwd:process.cwd(), pid:process.pid, effortOverride:process.env.CLAUDE_CODE_EFFORT_LEVEL };
const record = ${JSON.stringify(record)};
await Bun.write(record, JSON.stringify(capture));
${source}
`,
		{ mode: 0o700 }
	);

	return { ...emptyAiPreferences, provider, executable };
}

async function modelFixture(
	reply: string,
	provider: "claude-code" | "codex" = "codex"
): Promise<AiPreferences> {
	const executable = join(directory, "model agent");

	await writeFile(
		executable,
		`#!/usr/bin/env bun
import { createInterface } from "node:readline";
const requests = [];
const record = ${JSON.stringify(record)};
for await (const line of createInterface({input:process.stdin})) {
 const request = JSON.parse(line);
 requests.push(request);
 await Bun.write(record, JSON.stringify({requests,pid:process.pid,cwd:process.cwd()}));
 if (request.method === "initialize") console.info(JSON.stringify({id:request.id,result:{}}));
 if (request.method === "model/list") { ${reply} }
 if (request.type === "control_request") { ${reply} }
}
`,
		{ mode: 0o700 }
	);

	return { ...emptyAiPreferences, provider, executable };
}

it("reads Claude aliases, resolved IDs and model-specific effort from initialization without sending a prompt", async () => {
	const preferences = await modelFixture(
		'console.info(JSON.stringify({type:"control_response",response:{subtype:"success",request_id:request.request_id,response:{models:[{value:"opus",resolvedModel:"claude-opus-test",displayName:"Opus",supportsEffort:true,supportedEffortLevels:["low","medium","high","xhigh","max"]},{value:"old",supportsEffort:false},{value:"unknown"},{value:"invalid",supportedEffortLevels:["high\\\"bad"]}]}}}));',
		"claude-code"
	);

	const models = await new CliAgent().models(
		preferences,
		new AbortController().signal
	);

	const captured = JSON.parse(await readFile(record, "utf8"));

	expect(models[0]?.resolvedModel).toBe("claude-opus-test");
	expect(models[0]?.effort?.levels.map((level) => level.value)).toEqual([
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	expect(models[1]?.effort?.levels).toEqual([]);
	expect(models[2]?.effort).toBeUndefined();
	expect(models[3]?.effort).toBeUndefined();
	expect(captured.requests).toEqual([
		{
			type: "control_request",
			request_id: "1git-models",
			request: { subtype: "initialize", hooks: {} },
		},
	]);
	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
});

it("preserves Codex effort descriptions and defaults per model", async () => {
	const preferences = await modelFixture(
		'console.info(JSON.stringify({id:request.id,result:{data:[{model:"a",supportedReasoningEfforts:[{reasoningEffort:"minimal",description:"Quick"},{reasoningEffort:"xhigh",description:"Deep"}],defaultReasoningEffort:"xhigh"},{model:"b",supportedReasoningEfforts:[]},{model:"c"}],nextCursor:null}}));'
	);

	const models = await new CliAgent().models(
		preferences,
		new AbortController().signal
	);

	expect(models[0]?.effort).toEqual({
		source: "cli",
		default: "xhigh",
		levels: [
			{ value: "minimal", label: "Minimal", description: "Quick" },
			{ value: "xhigh", label: "Extra high", description: "Deep" },
		],
	});
	expect(models[1]?.effort?.levels).toEqual([]);
	expect(models[2]?.effort).toBeUndefined();
});

it("discovers Codex models across pages without starting a thread, filtering hidden, duplicate and non-text models", async () => {
	const preferences = await modelFixture(`
const data = request.params.cursor ? [{model:"second",displayName:"Second"},{model:"first"}] : [{model:"first",displayName:"First"},{model:"hidden",hidden:true},{model:"image",inputModalities:["image"]},{model:"bad model"}];
console.info(JSON.stringify({method:"notification",params:{}}));
const result = JSON.stringify({id:request.id,result:{data,nextCursor:request.params.cursor ? null : "next-page"}})+"\\n";
process.stdout.write(result.slice(0,9));
setTimeout(()=>process.stdout.write(result.slice(9)),5);
`);

	const models = await new CliAgent().models(
		preferences,
		new AbortController().signal
	);

	const captured = JSON.parse(await readFile(record, "utf8"));

	expect(models).toEqual([
		{ value: "first", label: "First" },
		{ value: "second", label: "Second" },
	]);
	expect(
		captured.requests.map((request: { method: string }) => request.method)
	).toEqual(["initialize", "initialized", "model/list", "model/list"]);
	expect(captured.requests.at(-1).params.cursor).toBe("next-page");
	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
});

it.each([
	'console.info(JSON.stringify({id:request.id,error:{code:1,message:"private-server-error"}}));',
	'console.info(JSON.stringify({id:request.id,result:{data:"invalid",nextCursor:null}}));',
	'console.info(JSON.stringify({id:request.id,result:{data:[{model:"example"}],nextCursor:"repeated-cursor"}}));',
])(
	"rejects invalid or looping model catalogs without exposing server data (%#)",
	async (reply) => {
		const preferences = await modelFixture(reply);

		await expect(
			new CliAgent().models(preferences, new AbortController().signal)
		).rejects.toThrow("Could not load Codex models");
		const captured = JSON.parse(await readFile(record, "utf8"));

		expect(existsSync(captured.cwd)).toBe(false);
	}
);

it("cancels a stalled model catalog request and removes its temporary directory", async () => {
	const preferences = await modelFixture(
		"/* Leave the catalog request pending. */"
	);

	await expect(
		new CliAgent().models(preferences, AbortSignal.timeout(1000))
	).rejects.toThrow("cancelled");
	const captured = JSON.parse(await readFile(record, "utf8"));

	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
});

it.each(["claude-code", "codex"] as const)(
	"handles %s cancellation during the initial stdin write without an unhandled rejection",
	async (provider) => {
		const preferences = await modelFixture(
			"/* Stay pending until cancelled. */",
			provider
		);

		const runner = join(directory, "cancel-write.ts");

		const moduleUrl = new URL(
			"../../src/feature/ai/lib/cli-agent.ts",
			import.meta.url
		).href;

		await writeFile(
			runner,
			`
const { ChildProcess } = require("node:child_process");
const realSpawn = ChildProcess.prototype.spawn;
const controller = new AbortController();
const unhandled = [];
let pid;
let cwd;
process.on("unhandledRejection", error => unhandled.push(String(error)));
ChildProcess.prototype.spawn = function(options) {
 const result = realSpawn.call(this, options);
 pid = this.pid;
 cwd = options.cwd;
 this.stdin.write = () => {
  controller.abort();
  throw new Error("The input stream closed during cancellation.");
 };
 return result;
};
const { CliAgent } = await import(${JSON.stringify(moduleUrl)});
const outcome = await new CliAgent().models(${JSON.stringify(preferences)}, controller.signal).then(() => "unexpected success", error => String(error));
await Bun.sleep(1100);
console.info(JSON.stringify({unhandled, outcome, pid, cwd}));
process.exit(0);
`
		);
		const child = Bun.spawn([process.execPath, runner], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const [output, errors, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);

		const captured = JSON.parse(output);

		expect(captured.unhandled).toEqual([]);
		expect(code).toBe(0);
		expect(errors).toBe("");
		expect(captured.outcome).toContain("cancelled");
		expect(existsSync(captured.cwd)).toBe(false);
		expect(() => process.kill(captured.pid, 0)).toThrow();
	}
);

const success =
	'console.info(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"fix: handle empty greetings"}));';

it.each(["claude-code", "codex"] as const)(
	"runs %s from a disposable cwd with stdin and no shell interpolation",
	async (provider) => {
		const reply =
			provider === "claude-code"
				? success
				: `
console.info(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Checking the supplied diff."}}));
console.info(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"fix: handle empty greetings"}}));
console.info(JSON.stringify({type:"turn.completed"}));`;

		const preferences = await fixture(reply, provider);
		const patch = `+hello $(touch ${join(directory, "injected")})`;
		const agent = new CliAgent();

		const message = await agent.generate(
			preferences,
			patch,
			new AbortController().signal
		);

		const captured = JSON.parse(await readFile(record, "utf8"));

		expect(message).toBe("fix: handle empty greetings");
		expect(captured.input).toContain(patch);
		expect(captured.args).not.toContain(patch);
		expect(captured.args).not.toContain("--model");
		expect(captured.cwd).not.toBe(directory);
		expect(existsSync(captured.cwd)).toBe(false);
		expect(existsSync(join(directory, "injected"))).toBe(false);

		if (provider === "claude-code") {
			expect(captured.args).not.toContain("--effort");
			expect(captured.args).toContain("--no-session-persistence");
			expect(captured.args).toContain("--strict-mcp-config");
			expect(captured.args[captured.args.indexOf("--tools") + 1]).toBe("");
			expect(captured.args).toContain('{"disableAllHooks":true}');
		} else {
			expect(
				captured.args.some((arg: string) =>
					arg.startsWith("model_reasoning_effort=")
				)
			).toBe(false);
			expect(captured.args).toContain("--ephemeral");
			expect(captured.args).toContain("read-only");
			expect(captured.args).toContain("features.shell_tool=false");
			expect(captured.args).toContain("features.hooks=false");
			expect(captured.args).toContain(
				"mcp_servers.example-server.enabled=false"
			);
		}
	}
);

it.each(["claude-code", "codex"] as const)(
	"passes explicit model, High effort and style preferences to %s",
	async (provider) => {
		const reply =
			provider === "claude-code"
				? success
				: 'console.info(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"fix: selected changes"}})); console.info(JSON.stringify({type:"turn.completed"}));';

		const preferences = await fixture(reply, provider);
		const previous = process.env.CLAUDE_CODE_EFFORT_LEVEL;

		process.env.CLAUDE_CODE_EFFORT_LEVEL = "low";

		try {
			await new CliAgent().generate(
				{
					...preferences,
					model: "test-model",
					effort: "high",
					instructions: "Use Conventional Commits.",
				},
				"+selected",
				new AbortController().signal
			);
		} finally {
			if (previous === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
			else process.env.CLAUDE_CODE_EFFORT_LEVEL = previous;
		}

		const captured = JSON.parse(await readFile(record, "utf8"));

		expect(captured.args[captured.args.indexOf("--model") + 1]).toBe(
			"test-model"
		);
		expect(captured.effortOverride).toBe(
			provider === "claude-code" ? undefined : "low"
		);

		if (provider === "claude-code")
			expect(captured.args[captured.args.indexOf("--effort") + 1]).toBe("high");
		else expect(captured.args).toContain('model_reasoning_effort="high"');

		expect(captured.input).toContain("Use Conventional Commits.");
		expect(captured.args).not.toContain("Use Conventional Commits.");
	}
);

it.each(
	(["claude-code", "codex"] as const).flatMap((provider) => [
		{
			provider,
			requested: undefined,
			levels: ["low", "medium", "high"],
			expected: "medium",
			model: "test-model",
		},
		{
			provider,
			requested: "max",
			levels: ["low", "medium", "high", "max"],
			expected: "max",
			model: "test-model",
		},
		{
			provider,
			requested: "",
			levels: ["low", "medium", "high"],
			expected: undefined,
			model: "test-model",
		},
		{
			provider,
			requested: "high",
			levels: ["low", "medium", "high"],
			expected: undefined,
			model: "custom-model",
		},
		{
			provider,
			requested: "high",
			levels: [],
			expected: undefined,
			model: "test-model",
		},
	])
)(
	"uses reported effort or inherits settings for $provider ($model, $requested, $levels)",
	async ({ provider, requested, levels, expected, model }) => {
		const reply =
			provider === "claude-code"
				? success
				: 'console.info(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"fix: selected changes"}})); console.info(JSON.stringify({type:"turn.completed"}));';

		const preferences = await fixture(reply, provider, levels);
		const previous = process.env.CLAUDE_CODE_EFFORT_LEVEL;

		process.env.CLAUDE_CODE_EFFORT_LEVEL = "low";

		try {
			await new CliAgent().generate(
				{ ...preferences, model, effort: requested },
				"+selected",
				new AbortController().signal
			);
		} finally {
			if (previous === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
			else process.env.CLAUDE_CODE_EFFORT_LEVEL = previous;
		}

		const captured = JSON.parse(await readFile(record, "utf8"));

		if (provider === "claude-code") {
			expect(captured.args.includes("--effort")).toBe(expected !== undefined);

			if (expected)
				expect(captured.args[captured.args.indexOf("--effort") + 1]).toBe(
					expected
				);

			expect(captured.effortOverride).toBe(expected ? undefined : "low");
		} else {
			expect(
				captured.args.find((arg: string) =>
					arg.startsWith("model_reasoning_effort=")
				)
			).toBe(expected ? `model_reasoning_effort="${expected}"` : undefined);
		}
	}
);

it.each([
	'console.error("private-provider-secret"); process.exit(1);',
	'console.info("private-provider-secret");',
	'console.info(JSON.stringify({type:"result",subtype:"success",is_error:true,result:"private-provider-secret"}));',
	'console.info(JSON.stringify({type:"result",subtype:"success",result:""}));',
	'console.info(JSON.stringify({type:"result",subtype:"success",result:"x".repeat(8001)}));',
	'console.info("x".repeat(1024*1024+1));',
	'console.error("x".repeat(1024*1024+1));',
])(
	"rejects failed, invalid or oversized output without exposing provider data (%#)",
	async (source) => {
		const preferences = await fixture(source);
		let failure: unknown;

		try {
			await new CliAgent().generate(
				preferences,
				"+selected",
				new AbortController().signal
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect(String(failure)).not.toContain("private-provider-secret");
		const captured = JSON.parse(await readFile(record, "utf8"));

		expect(existsSync(captured.cwd)).toBe(false);
	}
);

it.each([
	'console.info(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"incomplete"}}));',
	'console.info(JSON.stringify({type:"turn.failed",error:{message:"private-provider-secret"}}));',
])("rejects incomplete or failed Codex turns (%#)", async (source) => {
	const preferences = await fixture(source, "codex");

	await expect(
		new CliAgent().generate(
			preferences,
			"+selected",
			new AbortController().signal
		)
	).rejects.toThrow("completed commit message");
});

it("rejects oversized input and cancelled requests before invoking an executable", async () => {
	const preferences = await fixture(success);
	const controller = new AbortController();

	await expect(
		new CliAgent().generate(
			preferences,
			"x".repeat(64 * 1024 + 1),
			controller.signal
		)
	).rejects.toThrow("64 KiB");
	controller.abort();
	await expect(
		new CliAgent().generate(preferences, "+selected", controller.signal)
	).rejects.toThrow();
	expect(existsSync(record)).toBe(false);
});

it("times out a stalled agent and cleans its temporary cwd", async () => {
	const preferences = await fixture("setInterval(() => {}, 1000);");

	await expect(
		new CliAgent(1000).generate(
			preferences,
			"+selected",
			new AbortController().signal
		)
	).rejects.toThrow("timed out");
	const captured = JSON.parse(await readFile(record, "utf8"));

	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
});

it("reports rate limits promptly without waiting for the CLI's retry backoff", async () => {
	const preferences = await fixture(
		'console.error("last status: 429 Too Many Requests private-provider-secret"); setInterval(() => {}, 1000);'
	);

	await expect(
		new CliAgent().generate(
			preferences,
			"+selected",
			new AbortController().signal
		)
	).rejects.toThrow("usage limit");
	const captured = JSON.parse(await readFile(record, "utf8"));

	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
});

it("cancels the process group including descendants that ignore SIGTERM", async () => {
	const preferences = await fixture(`
process.on("SIGTERM", () => {});
const child = Bun.spawn([process.execPath, "-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {stdout:"ignore",stderr:"ignore"});
await Bun.write(record, JSON.stringify({...capture, childPid:child.pid}));
setInterval(() => {}, 1000);`);

	const controller = new AbortController();

	const pending = new CliAgent().generate(
		preferences,
		"+selected",
		controller.signal
	);

	const outcome = pending.then(
		() => null,
		(error: unknown) => error
	);

	let captured: { pid: number; childPid: number; cwd: string } | undefined;
	const deadline = Date.now() + 3000;

	while (Date.now() < deadline) {
		if (existsSync(record))
			captured = JSON.parse(await readFile(record, "utf8"));

		if (captured?.childPid) break;

		await Bun.sleep(10);
	}

	controller.abort();
	expect(await outcome).toBeInstanceOf(Error);
	expect(captured?.childPid).toBeNumber();

	if (!captured) throw new Error("The fixture did not start its descendant.");

	expect(existsSync(captured.cwd)).toBe(false);
	expect(() => process.kill(captured.pid, 0)).toThrow();
	expect(() => process.kill(captured.childPid, 0)).toThrow();
});
