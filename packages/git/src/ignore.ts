import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { IgnoreRule } from "./contracts.js";
import { invalidInput } from "./result.js";
import { requireRepositoryPaths } from "./validation.js";

const SPECIAL_PATTERN_CHARACTER = /[\\*?[\] #!]/g;
const UNSUPPORTED_PATH_CHARACTER = /[\r\n\0]/;
const MAX_IGNORE_BYTES = 1024 * 1024;

/** Literal Git ignore patterns and append-only writes, called under the repository mutation gate. */
export class GitIgnore {
	static extension(path: string): string | null {
		const name = path.slice(path.lastIndexOf("/") + 1);
		const dot = name.lastIndexOf(".");

		return dot > 0 && dot < name.length - 1 ? name.slice(dot) : null;
	}

	static folders(path: string): string[] {
		const segments = path.split("/");

		segments.pop();
		const folders: string[] = [];

		while (segments.length) {
			folders.push(segments.join("/"));
			segments.pop();
		}

		return folders;
	}

	/** Escapes glob metacharacters, whitespace, comments and negation in literal paths. */
	static pattern(path: string, rule: IgnoreRule): string {
		requireRepositoryPaths([path], "ignore-files");

		if (
			UNSUPPORTED_PATH_CHARACTER.test(path) ||
			path
				.split("/")
				.some(
					(part) => !part || part === "." || part === ".." || part === ".git"
				)
		)
			throw invalidInput(
				"ignore-files",
				"Choose an ordinary repository-relative path without line breaks."
			);

		const escape = (value: string) =>
			value.replace(SPECIAL_PATTERN_CHARACTER, "\\$&");

		switch (rule.kind) {
			case "file":
				return `/${escape(path)}`;
			case "folder":
				if (!GitIgnore.folders(path).includes(rule.path))
					throw invalidInput(
						"ignore-files",
						"Choose a parent folder of the selected file."
					);

				return `/${escape(rule.path)}/`;
			case "extension": {
				const extension = GitIgnore.extension(path);

				if (!extension)
					throw invalidInput(
						"ignore-files",
						"This file has no extension to ignore."
					);

				return `*${escape(extension)}`;
			}
		}
	}

	/** Preserves existing bytes and line endings; never follows links or overwrites another writer's data. */
	static async append(root: string, pattern: string): Promise<void> {
		const file = await open(
			join(root, ".gitignore"),
			constants.O_RDWR |
				constants.O_APPEND |
				constants.O_CREAT |
				constants.O_NOFOLLOW |
				constants.O_NONBLOCK,
			0o644
		);

		try {
			const info = await file.stat();

			if (!info.isFile() || info.nlink !== 1 || info.size > MAX_IGNORE_BYTES)
				throw invalidInput(
					"ignore-files",
					".gitignore must be an ordinary file smaller than 1 MiB, without hard links."
				);

			const content = await file.readFile();
			const text = content.toString("utf8");

			if (
				text
					.split(/\r?\n/)
					.filter((line) => line.length)
					.at(-1) === pattern
			)
				return;

			const newline = text.includes("\r\n") ? "\r\n" : "\n";
			const separator = content.length && content.at(-1) !== 10 ? newline : "";

			await file.writeFile(`${separator}${pattern}${newline}`);
			await file.sync();
		} finally {
			await file.close();
		}
	}
}
