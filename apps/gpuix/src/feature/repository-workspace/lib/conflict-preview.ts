import { createTwoFilesPatch } from "diff";
import { diffLimits } from "./repository-diff";

const startMarker = /^<{7,}(?:\s|$)/;
const anyMarker = /^(?:<{7,}|={7,}|>{7,}|\|{7,})(?:\s|$)/;
const hunkHeader = /^@@ /m;
const headerControl = /[\r\n\t]/g;

/** A bounded patch from an actual indexed version to the unchanged working file. */
export interface ConflictComparison {
	readonly patch: string;
	readonly message: string | null;
}

/** Display-only marker locations; Git independently validates the content before any resolution. */
export class ConflictPreviewModel {
	/** Native split rows align the source and working result without reconstructing either side. */
	static compare(
		path: string,
		source: string | null | undefined,
		result: string,
		context = 3
	): ConflictComparison {
		if (source == null)
			return {
				patch: "",
				message:
					"This indexed version is unavailable. Choose the other version or open your editor.",
			};

		for (const text of [source, result]) {
			const lines = text.split("\n");

			if (
				Buffer.byteLength(text) > diffLimits.bytes ||
				lines.length > diffLimits.lines ||
				lines.some((line) => line.length > diffLimits.lineLength)
			)
				return {
					patch: "",
					message:
						"This comparison is too large to preview. Open the file in your editor.",
				};
		}

		// Native language detection reads the unquoted +++ path; keep control characters out of its header.
		const headerPath = path.replace(headerControl, (value) =>
			JSON.stringify(value).slice(1, -1)
		);

		const name = (prefix: string) => `${prefix}/${headerPath}`;

		const body = createTwoFilesPatch(
			name("a"),
			name("b"),
			source,
			result,
			undefined,
			undefined,
			{ context, timeout: 100, maxEditLength: diffLimits.lines }
		);

		const patch = body
			? `diff --git ${JSON.stringify(name("a"))} ${JSON.stringify(name("b"))}\n${body}`
			: "";

		if (
			!patch ||
			Buffer.byteLength(patch) > diffLimits.bytes ||
			patch.split("\n").length > diffLimits.lines
		)
			return {
				patch: "",
				message:
					"This comparison is too large to preview. Open the file in your editor.",
			};

		return {
			patch,
			message: hunkHeader.test(patch)
				? null
				: "The working result matches this version. Review it before marking it resolved.",
		};
	}

	static markers(text: string): {
		starts: readonly number[];
		unresolved: boolean;
	} {
		const starts: number[] = [];
		let unresolved = false;

		for (const [index, line] of text.split("\n").entries()) {
			if (startMarker.test(line)) starts.push(index);

			if (anyMarker.test(line)) unresolved = true;
		}

		return { starts, unresolved };
	}
}
