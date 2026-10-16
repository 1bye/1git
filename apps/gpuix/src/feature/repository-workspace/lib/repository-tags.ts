import {
	type CreateReleaseTagInput,
	type GitResult,
	type TagInfo,
} from "@1git/git";
import { GitRepository } from "../../machines/repository-access";

const tagTimeoutMs = 120_000;

/** Local tag metadata and reviewed release creation; publishing belongs to the authenticated sync boundary. */
export class RepositoryTags {
	private constructor() {}

	/** Display destinations without URL credentials or token-like query/fragment values. */
	static destinationLabel(value: string): string {
		if (!URL.canParse(value)) return value;

		const url = new URL(value);

		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";

		return url.href;
	}

	static async read(
		root: string,
		signal: AbortSignal
	): Promise<GitResult<readonly TagInfo[]>> {
		const opened = await GitRepository.open({ path: root, signal });

		return opened.ok ? await opened.value.getTags({ signal }) : opened;
	}

	static async create(root: string, input: CreateReleaseTagInput) {
		const timeout = AbortSignal.timeout(tagTimeoutMs);

		const signal = input.signal
			? AbortSignal.any([input.signal, timeout])
			: timeout;

		const opened = await GitRepository.open({ path: root, signal });

		if (!opened.ok) return opened;

		const result = await opened.value.createReleaseTag({ ...input, signal });

		return !result.ok && result.error.code === "aborted"
			? {
					ok: false as const,
					error: {
						...result.error,
						retryable: false,
						message:
							"Tag creation stopped. It may have completed; refresh History before retrying.",
					},
				}
			: result;
	}
}
