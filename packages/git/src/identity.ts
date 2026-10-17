import { homedir } from "./runtime.js";
import type { GitResult } from "./contracts.js";
import { GitCommandFailure, GitProcess } from "./process/git-process.js";
import { fail, invalidInput, succeed, toGitError } from "./result.js";

/** Commit attribution, separate from hosting credentials. Missing values inherit Git defaults. */
export interface GitIdentityValues {
	readonly name: string | null;
	readonly email: string | null;
}

/** Narrow, repository-independent access to computer-wide author settings. */
export class GitIdentity {
	constructor(
		private readonly git = new GitProcess(),
		private readonly cwd = homedir()
	) {}

	static validate(identity: GitIdentityValues): void {
		if (
			!identity.name?.trim() ||
			!identity.email?.trim() ||
			/[\r\n\0<>]/.test(identity.name) ||
			/[\r\n\0]/.test(identity.email) ||
			!/^[^\s@<>]+@[^\s@<>]+$/.test(identity.email.trim())
		)
			throw invalidInput(
				"set-config",
				"Enter a name and a valid commit email address."
			);
	}

	async read(signal?: AbortSignal): Promise<GitResult<GitIdentityValues>> {
		try {
			const [name, email] = await Promise.all([
				this.value("user.name", signal),
				this.value("user.email", signal),
			]);

			return succeed({ name, email });
		} catch (error) {
			return fail(toGitError("get-config", error));
		}
	}

	/** Saves only author keys, never credentials. A failed pair must be reread before retrying. */
	async write(
		identity: GitIdentityValues
	): Promise<GitResult<GitIdentityValues>> {
		try {
			GitIdentity.validate(identity);
			await this.git.run({
				cwd: this.cwd,
				args: ["config", "--global", "user.name", identity.name?.trim() ?? ""],
			});
			await this.git.run({
				cwd: this.cwd,
				args: [
					"config",
					"--global",
					"user.email",
					identity.email?.trim() ?? "",
				],
			});

			return await this.read();
		} catch (error) {
			return fail(toGitError("set-config", error));
		}
	}

	private async value(
		key: string,
		signal?: AbortSignal
	): Promise<string | null> {
		try {
			const output = await this.git.run({
				cwd: this.cwd,
				args: ["config", "--global", "--get", key],
				signal,
			});

			return output.stdout.toString("utf8").trimEnd();
		} catch (error) {
			if (error instanceof GitCommandFailure && error.exitCode === 1)
				return null;

			throw error;
		}
	}
}
