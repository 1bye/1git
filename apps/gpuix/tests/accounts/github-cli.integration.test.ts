/**
 * Covers: executable discovery, explicit argv, environment isolation, safe failures and cancellation.
 * Real: OS child-process boundary and GitHubCli with an isolated executable on PATH.
 * Doubles: gh executable emits synthetic credentials; no real gh account, keychain or network.
 * Requires: POSIX shell.
 */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubCli } from "../../src/feature/accounts/lib/github-cli";

let directory: string;
let previous: NodeJS.ProcessEnv;

const keys = [
	"PATH",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GH_ENTERPRISE_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN",
];

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "1git-gh-process-"));
	previous = {};

	for (const key of keys) previous[key] = process.env[key];

	process.env.PATH = directory;

	for (const key of keys.slice(1)) process.env[key] = "synthetic-env-token";
});

afterEach(() => {
	for (const key of keys) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}

	rmSync(directory, { recursive: true, force: true });
});

it("executes gh with exact account arguments and without inherited token overrides", async () => {
	writeFileSync(
		join(directory, "gh"),
		`#!/bin/sh
if [ -n "$GH_TOKEN$GITHUB_TOKEN$GH_ENTERPRISE_TOKEN$GITHUB_ENTERPRISE_TOKEN" ]; then exit 2; fi
if [ "$GH_PROMPT_DISABLED" != "1" ]; then exit 3; fi
case "$*" in
  "auth status --json hosts") printf '%s' '{"hosts":{"github.com":[{"login":"tester","active":false,"state":"success"}]}}' ;;
  "auth token --hostname github.com --user tester") printf '%s\\n' 'synthetic-process-token' ;;
  *) exit 4 ;;
esac
`,
		{ mode: 0o700 }
	);
	const cli = new GitHubCli();

	expect(await cli.accounts()).toEqual([
		{ host: "github.com", username: "tester", active: false },
	]);
	expect(await cli.token({ host: "github.com", username: "tester" })).toBe(
		"synthetic-process-token"
	);
	expect(process.env.GH_TOKEN).toBe("synthetic-env-token");
});

it("discovers older gh accounts from masked stderr, including partial authentication failures", async () => {
	writeFileSync(
		join(directory, "gh"),
		`#!/bin/sh
case "$*" in
  "auth status --json hosts") printf 'unknown flag: --json\\n' >&2; exit 1 ;;
  "auth status") /bin/cat >&2 <<'STATUS'
github.com
  ✓ Logged in to github.com account personal (keyring)
  - Active account: true
  - Token: gho_********
  X Failed to log in to github.com account expired (keyring)
  - Active account: false
  - The token in keyring is invalid.
  ✓ Logged in to github.com account work (keyring)
  - Active account: false
code.example.test
  ✓ Logged in to code.example.test account employee (keyring)
  - Active account: true
STATUS
  exit 1 ;;
  *) exit 2 ;;
esac
`,
		{ mode: 0o700 }
	);

	expect(await new GitHubCli().accounts()).toEqual([
		{ host: "github.com", username: "personal", active: true },
		{ host: "github.com", username: "work", active: false },
		{ host: "code.example.test", username: "employee", active: true },
	]);
});

it("reports empty accounts for older gh when signed out and rejects unrecognized legacy output", async () => {
	const script = (status: string) => `#!/bin/sh
if [ "$*" = "auth status --json hosts" ]; then
  printf 'unknown flag: --json\\n' >&2
else
  printf '%s\\n' '${status}' >&2
fi
exit 1
`;

	writeFileSync(
		join(directory, "gh"),
		script(
			"You are not logged into any GitHub hosts. To log in, run: gh auth login"
		),
		{ mode: 0o700 }
	);
	expect(await new GitHubCli().accounts()).toEqual([]);
	writeFileSync(join(directory, "gh"), script("synthetic-unknown-secret"), {
		mode: 0o700,
	});
	await expect(new GitHubCli().accounts()).rejects.toThrow(
		"GitHub CLI is unavailable"
	);
});

it("does not expose child stdout/stderr when credential access fails", async () => {
	writeFileSync(
		join(directory, "gh"),
		"#!/bin/sh\nprintf 'synthetic-secret-out'\nprintf 'synthetic-secret-error' >&2\nexit 1\n",
		{ mode: 0o700 }
	);

	try {
		await new GitHubCli().token({ host: "github.com", username: "tester" });

		throw new Error("Expected credential failure");
	} catch (error) {
		expect(error).toBeInstanceOf(Error);
		expect(String(error)).toContain("GitHub CLI is unavailable");
		expect(String(error)).not.toContain("synthetic-secret");
		expect(JSON.stringify(error)).not.toContain("synthetic-secret");
	}
});

it("cancels a running credential process", async () => {
	writeFileSync(join(directory, "gh"), "#!/bin/sh\nexec /bin/sleep 10\n", {
		mode: 0o700,
	});
	const controller = new AbortController();
	const pending = new GitHubCli().accounts(controller.signal);

	setTimeout(() => controller.abort(), 50);
	await expect(pending).rejects.toThrow();
});
