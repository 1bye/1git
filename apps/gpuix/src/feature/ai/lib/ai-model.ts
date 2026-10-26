/** Provider-native values; missing metadata means unknown, and an empty list means unsupported. */
export interface AiModel {
	readonly value: string;
	readonly label: string;
	readonly resolvedModel?: string;
	readonly effort?: {
		readonly source: "cli" | "catalog";
		readonly levels: readonly {
			value: string;
			label: string;
			description?: string;
		}[];
		readonly default?: string;
	};
}

export function isEffort(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/u.test(value);
}

export function effortLabel(value: string): string {
	if (value === "xhigh") return "Extra high";

	return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

export function findModel(
	models: readonly AiModel[],
	value: string
): AiModel | undefined {
	// An empty selection inherits CLI configuration, which can differ from its recommended default.
	if (!value) return undefined;

	return (
		models.find((model) => model.value === value) ??
		models.find((model) => model.resolvedModel === value)
	);
}

/** Empty string explicitly inherits provider settings; undefined picks Medium only when supported. */
export function modelEffort(
	model: AiModel | undefined,
	requested?: string
): string {
	const capability = model?.effort;

	if (!capability || requested === "") return "";

	if (requested && capability.levels.some((level) => level.value === requested))
		return requested;

	if (capability.levels.some((level) => level.value === "medium"))
		return "medium";

	return (
		capability.levels.find((level) => level.value === capability.default)
			?.value ?? ""
	);
}
