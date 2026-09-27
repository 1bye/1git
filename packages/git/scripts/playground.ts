import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

const pixel = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAbElEQVRogeXOMQEAIAzAsGqbFeQjgsnIwZE/zbnvZ+mAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAtuhBeS1bkie1AAAAAElFTkSuQmCC",
	"base64"
);

const greenPixel = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAbElEQVRogeXOMQEAIAzAsAqYYBRhk8nIwZE/zT3vZ+mAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAtjgmSQBLnghsAAAAAElFTkSuQmCC",
	"base64"
);

const svg = (color: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect x="16" y="16" width="288" height="148" rx="24" fill="${color}"/><circle cx="160" cy="90" r="40" fill="white"/></svg>\n`;

/** Offline, disposable repositories for manual desktop testing. Never accepts an existing destination. */
export class GitPlayground {
	private constructor() {}

	/** Creates a fresh temporary root; older playgrounds are never reset or deleted. */
	static async create(): Promise<string> {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "1git-playground-"))
		);

		const changes = join(root, "01-changes");
		const compare = join(root, "02-compare");
		const sync = join(root, "03-sync");
		const conflict = join(root, "04-conflict");
		const remote = join(root, "origin.git");
		const peer = join(root, "remote-peer");

		try {
			await mkdir(join(root, "empty-hooks"));
			await mkdir(join(root, "empty-template"));

			for (const path of [changes, compare, sync, conflict]) {
				await mkdir(path);
				await GitPlayground.git(
					path,
					"init",
					"--initial-branch=main",
					`--template=${join(root, "empty-template")}`
				);
				await GitPlayground.configure(path, root);
				await writeFile(
					join(path, "README.md"),
					"# Playground\n\nThis is disposable example data.\n"
				);
				await writeFile(
					join(path, "message.txt"),
					"Hello from the common ancestor.\n"
				);
				await GitPlayground.commit(path, "Initial example");
			}

			await writeFile(
				join(changes, "rename-me.txt"),
				"Rename me without changing my contents.\n"
			);
			await writeFile(join(changes, "delete-me.txt"), "Delete this example.\n");
			await writeFile(join(changes, "badge.svg"), svg("#4263eb"));
			await writeFile(join(changes, "pixel.png"), pixel);
			await GitPlayground.commit(changes, "Add file and image examples");
			await writeFile(join(changes, "message.txt"), "Work saved for later.\n");
			await writeFile(
				join(changes, "stash-note.txt"),
				"An untracked file saved in the stash.\n"
			);
			await GitPlayground.git(
				changes,
				"stash",
				"push",
				"--include-untracked",
				"-m",
				"Example saved work"
			);
			await GitPlayground.git(changes, "mv", "rename-me.txt", "renamed.txt");
			await GitPlayground.git(changes, "rm", "delete-me.txt");
			await writeFile(
				join(changes, "message.txt"),
				"This version is staged.\n"
			);
			await GitPlayground.git(changes, "add", "message.txt");
			await writeFile(
				join(changes, "message.txt"),
				"This version is not staged.\n"
			);
			await writeFile(join(changes, "badge.svg"), svg("#0ca678"));
			await writeFile(join(changes, "new badge.svg"), svg("#e8590c"));
			await writeFile(join(changes, "new pixel.png"), pixel);
			await writeFile(join(changes, "pixel.png"), greenPixel);
			await writeFile(
				join(changes, "new file.txt"),
				"Select me for a commit, or discard me.\n"
			);
			await writeFile(join(changes, "binary.bin"), Buffer.from([0, 1, 2, 255]));

			await GitPlayground.git(compare, "switch", "-c", "feature/colors");
			await writeFile(join(compare, "badge.svg"), svg("#7950f2"));
			await GitPlayground.commit(compare, "Add a purple badge");
			await writeFile(join(compare, "colors.txt"), "purple\ngreen\norange\n");
			await GitPlayground.commit(compare, "Document the new colors");
			await GitPlayground.git(compare, "switch", "main");
			await writeFile(
				join(compare, "main-only.txt"),
				"This change should not appear as incoming from feature/colors.\n"
			);
			await GitPlayground.commit(compare, "Add main-only documentation");
			await GitPlayground.git(compare, "branch", "same-as-main");
			await GitPlayground.git(
				compare,
				"worktree",
				"add",
				"-b",
				"feature/worktree",
				join(root, "05-linked-worktree")
			);

			await GitPlayground.git(
				root,
				"init",
				"--bare",
				"--initial-branch=main",
				`--template=${join(root, "empty-template")}`,
				remote
			);
			await GitPlayground.configure(remote, root);
			await GitPlayground.git(sync, "remote", "add", "origin", remote);
			await GitPlayground.git(sync, "push", "-u", "origin", "main");
			await GitPlayground.git(
				root,
				"clone",
				`--template=${join(root, "empty-template")}`,
				remote,
				peer
			);
			await GitPlayground.configure(peer, root);
			await writeFile(
				join(peer, "incoming.txt"),
				"Fetch and pull this local remote update.\n"
			);
			await GitPlayground.commit(peer, "Incoming remote update");
			await GitPlayground.git(peer, "push");
			await GitPlayground.git(peer, "switch", "-c", "remote-only");
			await writeFile(
				join(peer, "remote-branch.txt"),
				"Check out this remote branch in the app.\n"
			);
			await GitPlayground.commit(peer, "Add remote-only branch");
			await GitPlayground.git(peer, "push", "-u", "origin", "remote-only");

			await GitPlayground.git(conflict, "switch", "-c", "feature/greeting");
			await writeFile(
				join(conflict, "message.txt"),
				"Hello from the feature branch.\n"
			);
			await GitPlayground.commit(conflict, "Change feature greeting");
			await GitPlayground.git(conflict, "switch", "main");
			await writeFile(join(conflict, "message.txt"), "Hello from main.\n");
			await GitPlayground.commit(conflict, "Change main greeting");

			try {
				await GitPlayground.git(
					conflict,
					"merge",
					"--no-edit",
					"feature/greeting"
				);
			} catch (error) {
				// Accept only the deliberately created conflict, not arbitrary Git failures.
				const unmerged = await GitPlayground.git(
					conflict,
					"diff",
					"--name-only",
					"--diff-filter=U"
				);

				if (unmerged.trim() !== "message.txt") throw error;
			}

			if (!(await GitPlayground.git(conflict, "ls-files", "-u")).trim())
				throw new Error("Expected a merge conflict.");

			await writeFile(join(root, "START-HERE.md"), GitPlayground.guide(root));

			return root;
		} catch (cause) {
			throw new Error(
				`Could not finish the playground. Partial files are preserved at ${root}.`,
				{ cause }
			);
		}
	}

	private static async git(cwd: string, ...args: string[]): Promise<string> {
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
		);

		const result = await execute(
			"git",
			[
				"-c",
				"protocol.allow=never",
				"-c",
				"protocol.file.allow=always",
				...args,
			],
			{
				cwd,
				env: {
					...env,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_TERMINAL_PROMPT: "0",
				},
			}
		);

		return result.stdout;
	}

	private static async configure(path: string, root: string): Promise<void> {
		for (const [key, value] of Object.entries({
			"user.name": "Playground User",
			"user.email": "playground@example.invalid",
			"commit.gpgsign": "false",
			"tag.gpgsign": "false",
			"core.hooksPath": join(root, "empty-hooks"),
			"core.fsmonitor": "false",
			"core.excludesFile": "/dev/null",
			"core.attributesFile": "/dev/null",
			"protocol.allow": "never",
			"protocol.file.allow": "always",
		}))
			await GitPlayground.git(path, "config", "--local", key, value);
	}

	private static async commit(path: string, message: string): Promise<void> {
		await GitPlayground.git(path, "add", "--all");
		await GitPlayground.git(path, "commit", "-m", message);
	}

	private static guide(root: string): string {
		return `# 1git playground

Open these folders using the app's Open repository action (one tab per folder).
In the macOS folder picker, press Command+Shift+G and paste the full path.

## Start here: branch comparison

Open ${join(root, "02-compare")}
- Click the active workspace tab → Compare → feature/colors.
- Expect two incoming commits and badge.svg + colors.txt; main-only.txt must NOT appear.
- Select either commit, inspect its files, then All branch changes.
- Compare same-as-main: expect no incoming commits or file changes.
- Back should retain your previous workspace view.

## Changes, previews, commits, history and stashes

Open ${join(root, "01-changes")}
- Inspect staged + unstaged message.txt, renamed/deleted files, new files, SVGs and PNG previews (blue before, green after).
- Try SVG Preview / Source, binary notice, filtering, multi-selection and native context menus.
- Select files and commit with any message. Inspect the result in History.
- Create a stash with untracked files; inspect it, then apply/pop/drop using confirmations.
- A saved example stash already exists. Applying it over dirty files may be blocked or conflict;
  commit or stash your current changes first for the successful path.

## Fetch, pull, push and remote branches

Open ${join(root, "03-sync")}
- Fetch: expect one incoming commit and origin/remote-only to appear.
- Pull: incoming.txt appears. Edit it, commit, then Push.
- All remote traffic goes to ${join(root, "origin.git")}, never GitHub.
- ${join(root, "remote-peer")} is a second local clone you can edit/commit/push to simulate a colleague.

## Conflict recovery

Open ${join(root, "04-conflict")}
- A merge is already paused with a conflict in message.txt.
- Exercise conflict resolution and Continue, OR Abort to restore main.

## Worktrees and branches

Open ${join(root, "05-linked-worktree")}, linked to 02-compare.
- Try opening the same worktree from the tab menu; it should reuse the tab.
- Try branch creation, rename, deletion, and new worktree creation in 02-compare.
- Remove the clean linked worktree from the main workspace; only that disposable folder is removed.

## Repeat / cleanup

Run bun run playground from the 1git checkout for a fresh independent set.
Previous sets are never reset or removed. Close their tabs and move this entire
generated folder to Trash when finished: ${root}
These are temporary files: the OS may clean them up. Do not store real work here.
This is a manual smoke-test playground, not exhaustive coverage of every Git edge case.
`;
	}
}

if (import.meta.main) {
	try {
		const root = await GitPlayground.create();

		process.stdout.write(
			`\nPlayground ready: ${root}\n\nStart with: ${join(root, "02-compare")}\nChecklist: ${join(root, "START-HERE.md")}\n\nOpen the repository folder in 1git. Run this command again for a fresh set.\n`
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? `${error.message}\n${String(error.cause ?? "")}` : String(error)}\n`
		);
		process.exitCode = 1;
	}
}
