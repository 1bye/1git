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

/** One omitted range before a displayed hunk or after the final hunk; context is read on demand. */
export interface DiffContextRequest {
	readonly oldLine: number;
	readonly newLine: number;
	readonly lines: number;
	readonly contextLines: number;
	readonly after?: boolean;
}

/** Extends only the requested gap, leaving the original changes and other gaps intact. */
export class DiffContext {
	private constructor() {}

	/** Without coordinates, selects the first remaining gap, then trailing context for keyboard expansion. */
	static request(
		patch: string,
		oldLine?: number,
		newLine?: number,
		after = false
	): DiffContextRequest | null {
		const parsed = DiffContext.parse(patch);

		if (after) {
			const last = parsed.hunks.at(-1);

			if (!last || !DiffContext.hasAfter(patch)) return null;

			let trailing = 0;

			for (const line of last.lines.toReversed()) {
				if (!line.startsWith(" ")) break;

				trailing++;
			}

			return {
				oldLine: last.oldLine,
				newLine: last.newLine,
				lines: expansionLines,
				contextLines: trailing + expansionLines,
				after: true,
			};
		}

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

		return oldLine === undefined && newLine === undefined
			? DiffContext.request(patch, undefined, undefined, true)
			: null;
	}

	/** Full syntax context supplies EOF without reading or displaying the entire file again. */
	static hasAfter(patch: string, fullPatch?: string): boolean {
		const current = DiffContext.parse(patch);
		const last = current.hunks.at(-1);

		if (
			!last ||
			last.lines.at(-1)?.startsWith("\\") ||
			current.header.some(
				(line) => line === "--- /dev/null" || line === "+++ /dev/null"
			)
		)
			return false;

		if (!fullPatch) return true;

		const full = DiffContext.parse(fullPatch);
		const end = full.hunks.at(-1);

		if (!end || full.header.join("\n") !== current.header.join("\n"))
			return true;

		return (
			end.oldLine + end.oldCount > last.oldLine + last.oldCount ||
			end.newLine + end.newCount > last.newLine + last.newCount
		);
	}

	/** A fresh Git patch must describe exactly the same edits before its context can be reused. */
	static expand(
		patch: string,
		candidate: string,
		request: DiffContextRequest
	): { patch: string; endReached: boolean } {
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

		const firstOld = request.after
			? hunk.oldLine + hunk.oldCount
			: hunk.oldLine - request.lines;

		const firstNew = request.after
			? hunk.newLine + hunk.newCount
			: hunk.newLine - request.lines;

		const noNewline = new Set<number>();

		for (const entry of source.hunks) {
			let old = entry.oldLine;
			let next = entry.newLine;

			for (const line of entry.lines) {
				// Retain only this click's range, not every unchanged line Git returned.
				if (
					line.startsWith(" ") &&
					old >= firstOld &&
					old < firstOld + request.lines &&
					next - firstNew === old - firstOld
				)
					context.set(old, line);

				if (line.startsWith("\\") && context.has(old - 1))
					noNewline.add(old - 1);

				if (line.startsWith(" ") || line.startsWith("-")) old += 1;

				if (line.startsWith(" ") || line.startsWith("+")) next += 1;
			}
		}

		const added: string[] = [];

		for (let offset = 0; offset < request.lines; offset += 1) {
			const line = context.get(firstOld + offset);

			if (line === undefined && request.after) break;

			if (line === undefined)
				throw new Error(
					"Git did not return the requested context. Refresh the diff and try again."
				);

			added.push(line);
		}

		const count = added.length;

		const endReached =
			!!request.after &&
			(count < request.lines || noNewline.has(firstOld + count - 1));

		if (request.after) {
			if (noNewline.has(firstOld + count - 1))
				added.push("\\ No newline at end of file");

			hunk.lines.push(...added);
		} else {
			hunk.oldLine -= count;
			hunk.newLine -= count;
			hunk.lines.unshift(...added);
		}

		hunk.oldCount += count;
		hunk.newCount += count;
		const previous = current.hunks[index - 1];

		if (
			!request.after &&
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

		return { patch: expanded, endReached };
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
