/** Two replacements with enough unchanged code for repeated, independent gap expansion. */
export const contextPatch = (contextLines = 3): string => {
	const changes = [40, 100];
	const ranges: { start: number; end: number }[] = [];

	for (const line of changes) {
		const start = Math.max(1, line - contextLines);
		const end = Math.min(150, line + contextLines);
		const previous = ranges.at(-1);

		if (previous && start <= previous.end + 1) previous.end = end;
		else ranges.push({ start, end });
	}

	const output = [
		"diff --git a/example.ts b/example.ts",
		"index 1111111..2222222 100644",
		"--- a/example.ts",
		"+++ b/example.ts",
	];

	for (const { start, end } of ranges) {
		const count = end - start + 1;

		output.push(`@@ -${start},${count} +${start},${count} @@ example`);

		for (let line = start; line <= end; line += 1) {
			if (changes.includes(line))
				output.push(`-line ${line}`, `+changed ${line}`);
			else output.push(` line ${line}`);
		}
	}

	return `${output.join("\n")}\n`;
};
