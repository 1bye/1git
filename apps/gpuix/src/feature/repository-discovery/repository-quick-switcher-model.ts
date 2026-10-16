import { basename } from "node:path";
import { MachineLocation } from "../machines/machine-location";

/** A known checkout, with machine identity kept separate from its displayed path. */
export interface QuickRepository {
	readonly path: string;
	readonly name: string;
	readonly displayPath: string;
	readonly machine: string;
	readonly branch?: string;
	readonly open: boolean;
}

/** Builds a deduplicated recent-first catalog and ranks name, path, branch and machine matches. */
export class RepositoryQuickSwitcherModel {
	static catalog(
		paths: readonly string[],
		opened: readonly { path: string; name: string; branch?: string }[],
		machineName: (id: string) => string
	): readonly QuickRepository[] {
		const tabs = new Map(opened.map((tab) => [tab.path, tab]));

		return [...new Set(paths)].map((path) => {
			const remote = MachineLocation.parse(path);
			const tab = tabs.get(path);
			const displayPath = remote?.path ?? path;

			return {
				path,
				displayPath,
				name: tab?.name ?? (basename(displayPath) || displayPath),
				machine: remote ? machineName(remote.machineId) : "This Mac",
				branch: tab?.branch,
				open: !!tab,
			};
		});
	}

	static search(
		items: readonly QuickRepository[],
		query: string
	): readonly QuickRepository[] {
		const words = query
			.trim()
			.toLocaleLowerCase()
			.split(/\s+/u)
			.filter(Boolean);

		if (!words.length) return items;

		return items
			.flatMap((item, order) => {
				const name = item.name.toLocaleLowerCase();

				const detail =
					`${item.displayPath} ${item.machine} ${item.branch ?? ""}`.toLocaleLowerCase();

				let score = 0;

				for (const word of words) {
					if (name === word) score += 100;
					else if (name.startsWith(word)) score += 60;
					else if (name.includes(word)) score += 40;
					else if (detail.includes(word)) score += 10;
					else return [];
				}

				return [{ item, score, order }];
			})
			.sort(
				(left, right) => right.score - left.score || left.order - right.order
			)
			.map(({ item }) => item);
	}
}
