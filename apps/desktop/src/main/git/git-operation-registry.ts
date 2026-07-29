import { randomUUID } from "node:crypto";
import type { GitOperation, GitResult } from "@1git/git";
import type {
	GitOperationCancellationResult,
	GitOperationId,
} from "../../shared/git-ipc.js";

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface ActiveGitOperation {
	readonly controller: AbortController;
	readonly owner: object;
}

export interface RunGitOperationInput<T> {
	readonly operation: GitOperation;
	readonly operationId?: GitOperationId;
	readonly owner: object;
	readonly task: (signal: AbortSignal) => Promise<GitResult<T>>;
}

/** Owns AbortControllers for cancellable main-process Git operations. */
export class GitOperationRegistry {
	private readonly activeOperations = new Map<
		GitOperationId,
		ActiveGitOperation
	>();

	get activeCount(): number {
		return this.activeOperations.size;
	}

	async run<T>({
		operation,
		operationId,
		owner,
		task,
	}: RunGitOperationInput<T>): Promise<GitResult<T>> {
		const id = operationId ?? this.nextOperationId();
		if (!isValidGitOperationId(id)) {
			return {
				error: {
					code: "invalid-input",
					message: "Operation ID has an invalid format.",
					operation,
					retryable: false,
				},
				ok: false,
			};
		}
		if (this.activeOperations.has(id)) {
			return {
				error: {
					code: "already-exists",
					message: `Git operation "${id}" is already active.`,
					operation,
					retryable: false,
				},
				ok: false,
			};
		}

		const activeOperation: ActiveGitOperation = {
			controller: new AbortController(),
			owner,
		};
		this.activeOperations.set(id, activeOperation);
		try {
			return await task(activeOperation.controller.signal);
		} finally {
			if (this.activeOperations.get(id) === activeOperation) {
				this.activeOperations.delete(id);
			}
		}
	}

	cancel(
		operationId: GitOperationId,
		owner: object
	): GitOperationCancellationResult {
		const activeOperation = this.activeOperations.get(operationId);
		if (!activeOperation || activeOperation.owner !== owner) {
			return { operationId, status: "not-found" };
		}
		activeOperation.controller.abort();
		return { operationId, status: "cancelled" };
	}

	abortAll(owner?: object): number {
		let abortedCount = 0;
		for (const activeOperation of this.activeOperations.values()) {
			if (owner === undefined || activeOperation.owner === owner) {
				activeOperation.controller.abort();
				abortedCount += 1;
			}
		}
		return abortedCount;
	}

	private nextOperationId(): GitOperationId {
		let operationId = randomUUID();
		while (this.activeOperations.has(operationId)) {
			operationId = randomUUID();
		}
		return operationId;
	}
}

export const isValidGitOperationId = (value: string): boolean =>
	OPERATION_ID_PATTERN.test(value);
