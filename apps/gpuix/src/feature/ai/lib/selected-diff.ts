const pageBytes = 10 * 1024;

/** Immutable, selection-only source for AI reads. It never exposes a filesystem path operation. */
export class SelectedDiff {
	readonly files: readonly {
		id: number;
		label: string;
		pages: number;
		added: number;
		deleted: number;
		hunks: number;
	}[];
	private readonly contents: readonly (readonly string[])[];

	constructor(patch: string) {
		const files = patch
			.split(/(?=^diff --git )/mu)
			.filter((part) => part.trim());

		this.contents = files.map((file) => SelectedDiff.split(file, pageBytes));
		this.files = files.map((file, id) => {
			let added = 0;
			let deleted = 0;
			let hunks = 0;

			for (const line of file.split("\n")) {
				if (line.startsWith("@@ ")) hunks++;
				else if (hunks && line.startsWith("+")) added++;
				else if (hunks && line.startsWith("-")) deleted++;
			}

			return {
				id,
				label: file.split("\n", 1)[0]!.slice(0, 240),
				pages: this.contents[id]!.length,
				added,
				deleted,
				hunks,
			};
		});
	}

	/** A byte ceiling also provides a conservative token ceiling without guessing the model's tokenizer. */
	static split(text: string, maxBytes: number): string[] {
		if (!Number.isInteger(maxBytes) || maxBytes < 4)
			throw new Error("Diff pages must allow at least one UTF-8 character.");

		const parts: string[] = [];
		let start = 0;
		let end = 0;
		let bytes = 0;

		for (const character of text) {
			const size = Buffer.byteLength(character);

			if (bytes + size > maxBytes) {
				parts.push(text.slice(start, end));
				start = end;
				bytes = 0;
			}

			bytes += size;
			end += character.length;
		}

		if (end > start) parts.push(text.slice(start));

		return parts;
	}

	/** Pages can split a long line; coordinates refer to immutable diff pages, not live working-file lines. */
	read(file: number, page: number): { text: string; nextPage: number | null } {
		if (
			!Number.isInteger(file) ||
			!Number.isInteger(page) ||
			file < 0 ||
			page < 0
		)
			throw new Error("Choose a selected file ID and a valid diff page.");

		const pages = this.contents[file];
		const text = pages?.[page];

		if (text === undefined)
			throw new Error("That file or page is outside the selected changes.");

		return { text, nextPage: page + 1 < pages!.length ? page + 1 : null };
	}

	/** Paginated metadata keeps all selected files discoverable without overflowing small model contexts. */
	overview(offset = 0): {
		files: SelectedDiff["files"];
		total: number;
		nextOffset: number | null;
	} {
		if (!Number.isInteger(offset) || offset < 0 || offset >= this.files.length)
			throw new Error("Choose a valid selected-file offset.");

		const end = Math.min(offset + 20, this.files.length);

		return {
			files: this.files.slice(offset, end),
			total: this.files.length,
			nextOffset: end < this.files.length ? end : null,
		};
	}

	/** Literal, bounded search over selection pages; never accepts filesystem paths or regex programs. */
	search(
		query: string,
		offset = 0
	): {
		matches: { file: number; page: number; excerpt: string }[];
		nextOffset: number | null;
	} {
		if (!query || query.length > 200 || !Number.isInteger(offset) || offset < 0)
			throw new Error("Choose a short literal query and valid offset.");

		const matches: { file: number; page: number; excerpt: string }[] = [];
		let cursor = 0;

		for (const file of this.files) {
			for (let page = 0; page < file.pages; page++) {
				if (cursor++ < offset) continue;

				const text = this.read(file.id, page).text;
				const index = text.indexOf(query);

				if (index >= 0)
					matches.push({
						file: file.id,
						page,
						excerpt: text.slice(
							Math.max(0, index - 100),
							index + query.length + 150
						),
					});

				if (matches.length === 12) return { matches, nextOffset: cursor };
			}
		}

		return { matches, nextOffset: null };
	}
}
