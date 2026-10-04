import { diffLimits } from "./repository-diff";

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const expansionLines = 20;

interface Hunk {
	oldLine: number;
	newLine: number;
	oldCount: number;
	newCount: number;
	suffix: string;
	lines: string[];
}
interface Patch {
	header: string[];
	hunks: Hunk[];
}

/** One omitted range immediately before a displayed hunk; context is read on demand. */
export interface DiffContextRequest {
	readonly oldLine: number;
	readonly newLine: number;
	readonly lines: number;
	readonly contextLines: number;
}

/** Extends only the requested gap, leaving the original changes and other gaps intact. */
export class DiffContext {
	private constructor() {}

	/** Without coordinates, selects the first remaining gap for keyboard expansion. */
	static request(
		patch: string,
		oldLine?: number,
		newLine?: number
	): DiffContextRequest | null {
		const parsed = DiffContext.parse(patch);

		for (const [index, hunk] of parsed.hunks.entries()) {
			if (
				(oldLine !== undefined && hunk.oldLine !== oldLine) ||
				(newLine !== undefined && hunk.newLine !== newLine)
			)
				continue;

			const previous = parsed.hunks[index - 1];
			const oldEnd = previous ? previous.oldLine + previous.oldCount : 1;
			const newEnd = previous ? previous.newLine + previous.newCount : 1;
			const hidden = hunk.oldLine - oldEnd;

			if (hidden <= 0 || hidden !== hunk.newLine - newEnd) continue;

			const lines = Math.min(expansionLines, hidden);
			let leading = 0;

			for (const line of hunk.lines) {
				if (!line.startsWith(" ")) break;

				leading += 1;
			}

			return {
				oldLine: hunk.oldLine,
				newLine: hunk.newLine,
				lines,
				contextLines: leading + lines,
			};
		}

		return null;
	}

	/** A fresh Git patch must describe exactly the same edits before its context can be reused. */
	static expand(
		patch: string,
		candidate: string,
		request: DiffContextRequest
	): string {
		const current = DiffContext.parse(patch);
		const source = DiffContext.parse(candidate);

		if (
			current.header.join("\n") !== source.header.join("\n") ||
			DiffContext.edits(current) !== DiffContext.edits(source)
		)
			throw new Error(
				"This file changed outside the app. Refresh the diff before expanding it."
			);

		const index = current.hunks.findIndex(
			(hunk) =>
				hunk.oldLine === request.oldLine && hunk.newLine === request.newLine
		);

		const hunk = current.hunks[index];

		if (!hunk) throw new Error("This diff section is no longer available.");

		const context = new Map<number, string>();
		const firstOld = hunk.oldLine - request.lines;
		const firstNew = hunk.newLine - request.lines;

		for (const entry of source.hunks) {
			let old = entry.oldLine;
			let next = entry.newLine;

			for (const line of entry.lines) {
				// Retain only this click's range, not every unchanged line Git returned.
				if (
					line.startsWith(" ") &&
					old >= firstOld &&
					old < hunk.oldLine &&
					next - firstNew === old - firstOld
				)
					context.set(old, line);

				if (line.startsWith(" ") || line.startsWith("-")) old += 1;

				if (line.startsWith(" ") || line.startsWith("+")) next += 1;
			}
		}

		const added: string[] = [];

		for (let offset = request.lines; offset > 0; offset -= 1) {
			const line = context.get(hunk.oldLine - offset);

			if (line === undefined)
				throw new Error(
					"Git did not return the requested context. Refresh the diff and try again."
				);

			added.push(line);
		}

		hunk.oldLine -= request.lines;
		hunk.newLine -= request.lines;
		hunk.oldCount += request.lines;
		hunk.newCount += request.lines;
		hunk.lines.unshift(...added);
		const previous = current.hunks[index - 1];

		if (
			previous &&
			previous.oldLine + previous.oldCount === hunk.oldLine &&
			previous.newLine + previous.newCount === hunk.newLine
		) {
			previous.lines.push(...hunk.lines);
			previous.oldCount += hunk.oldCount;
			previous.newCount += hunk.newCount;
			current.hunks.splice(index, 1);
		}

		const output = [...current.header];

		for (const entry of current.hunks) {
			output.push(
				`@@ -${entry.oldLine},${entry.oldCount} +${entry.newLine},${entry.newCount} @@${entry.suffix}`,
				...entry.lines
			);
		}

		const expanded = `${output.join("\n")}\n`;

		if (
			output.length + 1 > diffLimits.lines ||
			Buffer.byteLength(expanded) > diffLimits.bytes ||
			output.some((line) => line.length > diffLimits.lineLength)
		)
			throw new Error(
				"This preview reached its safe size limit. Open the file in your editor to read more."
			);

		return expanded;
	}

	private static parse(patch: string): Patch {
		const result: Patch = { header: [], hunks: [] };
		let hunk: Hunk | undefined;

		const lines = patch.split("\n");

		if (lines.at(-1) === "") lines.pop();

		for (const line of lines) {
			const match = hunkHeader.exec(line);

			if (match) {
				hunk = {
					oldLine: Number(match[1]),
					oldCount: Number(match[2] ?? 1),
					newLine: Number(match[3]),
					newCount: Number(match[4] ?? 1),
					suffix: match[5] ?? "",
					lines: [],
				};
				result.hunks.push(hunk);
			} else if (hunk) {
				if (!/^[ +\\-]/.test(line))
					throw new Error("Unsupported diff context format.");

				hunk.lines.push(line);
			} else result.header.push(line);
		}

		return result;
	}

	private static edits(patch: Patch): string {
		const edits: [number, number, string][] = [];

		for (const hunk of patch.hunks) {
			let old = hunk.oldLine;
			let next = hunk.newLine;

			for (const line of hunk.lines) {
				if (line.startsWith("+") || line.startsWith("-"))
					edits.push([old, next, line]);

				if (line.startsWith(" ") || line.startsWith("-")) old += 1;

				if (line.startsWith(" ") || line.startsWith("+")) next += 1;
			}
		}

		return JSON.stringify(edits);
	}
}
