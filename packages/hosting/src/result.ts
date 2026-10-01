import type {
	HostingError,
	HostingErrorCode,
	HostingResult,
} from "./contracts.js";

export class Failure extends Error {
	constructor(readonly details: Omit<HostingError, "operation">) {
		super(details.message);
	}
}

export function fail(code: HostingErrorCode, message: string): never {
	throw new Failure({ code, message, retryable: false });
}

export async function result<T>(
	operation: string,
	run: () => Promise<T>
): Promise<HostingResult<T>> {
	try {
		return { ok: true, value: await run() };
	} catch (error) {
		return failureResult(operation, error);
	}
}

export function failureResult(
	operation: string,
	error: unknown
): { ok: false; error: HostingError } {
	return {
		ok: false,
		error:
			error instanceof Failure
				? { ...error.details, operation }
				: {
						code: "network",
						operation,
						message: "The hosting operation could not be completed.",
						retryable: false,
					},
	};
}

export function nonempty(value: string, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.length > 4096)
		fail("validation", `Invalid ${label}.`);

	for (const character of value) {
		const code = character.charCodeAt(0);

		if (code < 32 || code === 127) fail("validation", `Invalid ${label}.`);
	}

	return value;
}

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		fail("invalid-response", "Expected an API object.");

	return value as Record<string, unknown>;
}

export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) fail("invalid-response", "Expected an API list.");

	return value;
}

export function string(value: unknown): string {
	if (typeof value !== "string") fail("invalid-response", "Expected API text.");

	return value;
}

export function optionalString(value: unknown): string | null {
	return value == null ? null : string(value);
}

export function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		fail("invalid-response", "Expected an API integer.");

	return value;
}

export function id(value: unknown): string {
	return typeof value === "string" && value.length
		? value
		: String(number(value));
}

export function boolean(value: unknown): boolean {
	if (typeof value !== "boolean")
		fail("invalid-response", "Expected an API boolean.");

	return value;
}
