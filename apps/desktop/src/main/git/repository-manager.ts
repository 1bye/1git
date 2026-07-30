import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	type CloneRepositoryInput,
	type GitCallOptions,
	type GitError,
	type GitOperation,
	GitRepository,
	type GitResult,
	type GitRuntimeOptions,
	type InitializeRepositoryInput,
} from "@1git/git";
import type {
	OpenedRepositorySession,
	RecentRepositoryRecord,
	RepositoryManagerError,
	RepositoryManagerResult,
	RepositoryManagerState,
	RepositorySessionId,
	RepositorySessionRecord,
} from "../../shared/repository-session.js";
import type { RecentRepositoryStore } from "./recent-repository-store.js";

const DEFAULT_MAX_RECENT_REPOSITORIES = 12;
const MAX_SESSION_ID_ATTEMPTS = 8;

interface ManagedRepositorySession {
	record: RepositorySessionRecord;
	readonly repository: GitRepository;
}

export interface RepositoryManagerOptions {
	readonly createSessionId?: () => string;
	readonly maxRecentRepositories?: number;
	readonly now?: () => Date;
	readonly onPersistenceError?: (error: Error) => void;
	readonly recentRepositoryStore?: RecentRepositoryStore;
	readonly repositoryPathExists?: (path: string) => boolean;
	readonly runtime?: GitRuntimeOptions;
}

export interface OpenRepositorySessionInput extends GitCallOptions {
	readonly path: string;
}

export type InitializeRepositorySessionInput = Omit<
	InitializeRepositoryInput,
	"runtime"
>;

export type CloneRepositorySessionInput = Omit<CloneRepositoryInput, "runtime">;

const succeed = <T>(value: T): RepositoryManagerResult<T> => ({
	ok: true,
	value,
});

const fail = <T>(
	error: RepositoryManagerError
): RepositoryManagerResult<T> => ({
	error,
	ok: false,
});

const gitFailure = <T>(gitError: GitError): RepositoryManagerResult<T> =>
	fail({
		code: "git-error",
		gitError,
		message: gitError.message,
	});

const missingSession = <T>(
	sessionId: RepositorySessionId
): RepositoryManagerResult<T> =>
	fail({
		code: "session-not-found",
		message: `Repository session "${sessionId}" was not found.`,
		sessionId,
	});

const copySessionRecord = (
	record: RepositorySessionRecord
): RepositorySessionRecord => ({
	id: record.id,
	lastActivatedAt: record.lastActivatedAt,
	openedAt: record.openedAt,
	repository: { ...record.repository },
});

const repositoryDirectoryExists = (path: string): boolean => {
	try {
		return isAbsolute(path) && statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const sameRecentRepositories = (
	first: readonly RecentRepositoryRecord[],
	second: readonly RecentRepositoryRecord[]
): boolean =>
	first.length === second.length &&
	first.every(
		(repository, index) =>
			repository.path === second[index]?.path &&
			repository.lastOpenedAt === second[index]?.lastOpenedAt
	);

/**
 * Owns GitRepository instances inside Electron's main process.
 *
 * Public methods return only structured records, never GitRepository objects.
 */
export class RepositoryManager {
	private activeSessionId: RepositorySessionId | null = null;
	private readonly createSessionId: () => string;
	private readonly maxRecentRepositories: number;
	private readonly now: () => Date;
	private readonly onPersistenceError?: (error: Error) => void;
	private openTail: Promise<void> = Promise.resolve();
	private recentRepositories: RecentRepositoryRecord[];
	private readonly recentRepositoryStore?: RecentRepositoryStore;
	private readonly repositoryRoots = new Map<string, RepositorySessionId>();
	private readonly repositoryPathExists: (path: string) => boolean;
	private readonly runtime?: GitRuntimeOptions;
	private readonly sessions = new Map<
		RepositorySessionId,
		ManagedRepositorySession
	>();

	constructor(options: RepositoryManagerOptions = {}) {
		const maxRecentRepositories =
			options.maxRecentRepositories ?? DEFAULT_MAX_RECENT_REPOSITORIES;
		if (!Number.isInteger(maxRecentRepositories) || maxRecentRepositories < 1) {
			throw new Error("maxRecentRepositories must be a positive integer.");
		}

		this.createSessionId = options.createSessionId ?? randomUUID;
		this.maxRecentRepositories = maxRecentRepositories;
		this.now = options.now ?? (() => new Date());
		this.onPersistenceError = options.onPersistenceError;
		this.recentRepositoryStore = options.recentRepositoryStore;
		this.repositoryPathExists =
			options.repositoryPathExists ?? repositoryDirectoryExists;
		this.recentRepositories = this.loadRecentRepositories();
		this.runtime = options.runtime;
	}

	/** Opens, snapshots, activates, and tracks a repository by canonical root. */
	async openRepository(
		input: OpenRepositorySessionInput
	): Promise<RepositoryManagerResult<OpenedRepositorySession>> {
		return await this.enqueueSessionOpen(async () =>
			this.ownRepository(
				await GitRepository.open({
					path: input.path,
					runtime: this.runtime,
					signal: input.signal,
				}),
				input.signal
			)
		);
	}

	/** Initializes a repository and retains the resulting main-process object. */
	async initializeRepository(
		input: InitializeRepositorySessionInput
	): Promise<RepositoryManagerResult<OpenedRepositorySession>> {
		return await this.enqueueSessionOpen(async () =>
			this.ownRepository(
				await GitRepository.initialize({
					...input,
					runtime: this.runtime,
				}),
				input.signal
			)
		);
	}

	/** Clones a repository and retains the resulting main-process object. */
	async cloneRepository(
		input: CloneRepositorySessionInput
	): Promise<RepositoryManagerResult<OpenedRepositorySession>> {
		return await this.enqueueSessionOpen(async () =>
			this.ownRepository(
				await GitRepository.clone({
					...input,
					runtime: this.runtime,
				}),
				input.signal
			)
		);
	}

	/**
	 * Runs a typed main-process operation without releasing its repository object.
	 */
	async performRepositoryOperation<T>(
		sessionId: RepositorySessionId,
		operation: GitOperation,
		task: (repository: GitRepository) => Promise<GitResult<T>>
	): Promise<GitResult<T>> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return {
				error: {
					code: "not-found",
					message: `Repository session "${sessionId}" was not found.`,
					operation,
					retryable: false,
				},
				ok: false,
			};
		}
		return await task(session.repository);
	}

	private async enqueueSessionOpen<T>(
		task: () => Promise<RepositoryManagerResult<T>>
	): Promise<RepositoryManagerResult<T>> {
		const previousOpen = this.openTail;
		const gate = Promise.withResolvers<void>();
		this.openTail = gate.promise;
		await previousOpen;

		try {
			return await task();
		} finally {
			gate.resolve();
		}
	}

	/** Activates an existing session and moves its repository to recent-first. */
	activateSession(
		sessionId: RepositorySessionId
	): RepositoryManagerResult<RepositoryManagerState> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return missingSession(sessionId);
		}

		const activatedAt = this.timestamp();
		this.touchSession(session, activatedAt);
		this.touchRecent(session.record.repository.root, activatedAt);
		this.activeSessionId = sessionId;
		return succeed(this.getState());
	}

	/** Returns one serializable session record. */
	getSession(
		sessionId: RepositorySessionId
	): RepositoryManagerResult<RepositorySessionRecord> {
		const session = this.sessions.get(sessionId);
		return session
			? succeed(copySessionRecord(session.record))
			: missingSession(sessionId);
	}

	/** Returns the active session record, or null when no repository is open. */
	getActiveSession(): RepositorySessionRecord | null {
		if (!this.activeSessionId) {
			return null;
		}
		const session = this.sessions.get(this.activeSessionId);
		return session ? copySessionRecord(session.record) : null;
	}

	/** Returns a serializable snapshot of manager-owned session state. */
	getState(): RepositoryManagerState {
		this.pruneUnavailableRecentRepositories();
		return {
			activeSessionId: this.activeSessionId,
			recentRepositories: this.recentRepositories.map((repository) => ({
				...repository,
			})),
			sessions: [...this.sessions.values()]
				.reverse()
				.map((session) => copySessionRecord(session.record)),
		};
	}

	/** Closes one session while retaining its repository in recent history. */
	closeSession(
		sessionId: RepositorySessionId
	): RepositoryManagerResult<RepositoryManagerState> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return missingSession(sessionId);
		}

		this.sessions.delete(sessionId);
		this.repositoryRoots.delete(session.record.repository.root);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.mostRecentlyActivatedSessionId();
		}
		return succeed(this.getState());
	}

	/** Releases every GitRepository instance while retaining recent history. */
	closeAllSessions(): RepositoryManagerState {
		this.sessions.clear();
		this.repositoryRoots.clear();
		this.activeSessionId = null;
		return this.getState();
	}

	/** Removes a canonical repository path from recent history. */
	forgetRecentRepository(path: string): RepositoryManagerState {
		const repositories = this.recentRepositories.filter(
			(repository) => repository.path !== path
		);
		if (repositories.length !== this.recentRepositories.length) {
			this.recentRepositories = repositories;
			this.persistRecentRepositories();
		}
		return this.getState();
	}

	private async ownRepository(
		opened: GitResult<GitRepository>,
		signal?: AbortSignal
	): Promise<RepositoryManagerResult<OpenedRepositorySession>> {
		if (!opened.ok) {
			return gitFailure(opened.error);
		}

		const repositoryRoot = opened.value.info.root;
		const existingSessionId = this.repositoryRoots.get(repositoryRoot);
		const existingSession = existingSessionId
			? this.sessions.get(existingSessionId)
			: undefined;
		const repository = existingSession?.repository ?? opened.value;
		const snapshot = await repository.getSnapshot({ signal });
		if (!snapshot.ok) {
			return gitFailure(snapshot.error);
		}

		const activatedAt = this.timestamp();
		const session =
			existingSession ??
			this.createManagedSession(repository, activatedAt, repositoryRoot);
		this.touchSession(session, activatedAt);
		this.touchRecent(repositoryRoot, activatedAt);
		this.activeSessionId = session.record.id;

		return succeed({
			session: copySessionRecord(session.record),
			snapshot: snapshot.value,
		});
	}

	private createManagedSession(
		repository: GitRepository,
		openedAt: string,
		repositoryRoot: string
	): ManagedRepositorySession {
		const id = this.nextSessionId();
		const session: ManagedRepositorySession = {
			record: {
				id,
				lastActivatedAt: openedAt,
				openedAt,
				repository: { ...repository.info },
			},
			repository,
		};
		this.sessions.set(id, session);
		this.repositoryRoots.set(repositoryRoot, id);
		return session;
	}

	private nextSessionId(): RepositorySessionId {
		let attempts = 0;
		while (attempts < MAX_SESSION_ID_ATTEMPTS) {
			attempts += 1;
			const candidate = this.createSessionId();
			if (candidate.length > 0 && !this.sessions.has(candidate)) {
				return candidate;
			}
		}
		throw new Error("Could not create a unique repository session ID.");
	}

	private timestamp(): string {
		return this.now().toISOString();
	}

	private mostRecentlyActivatedSessionId(): RepositorySessionId | null {
		let mostRecentSession: ManagedRepositorySession | null = null;
		for (const session of this.sessions.values()) {
			if (
				!mostRecentSession ||
				session.record.lastActivatedAt >=
					mostRecentSession.record.lastActivatedAt
			) {
				mostRecentSession = session;
			}
		}
		return mostRecentSession?.record.id ?? null;
	}

	private touchSession(
		session: ManagedRepositorySession,
		activatedAt: string
	): void {
		session.record = {
			...session.record,
			lastActivatedAt: activatedAt,
		};
	}

	private touchRecent(path: string, lastOpenedAt: string): void {
		if (!this.repositoryPathExists(path)) {
			const repositories = this.recentRepositories.filter(
				(repository) => repository.path !== path
			);
			if (repositories.length !== this.recentRepositories.length) {
				this.recentRepositories = repositories;
				this.persistRecentRepositories();
			}
			return;
		}

		const recentRepositories: RecentRepositoryRecord[] = [
			{ lastOpenedAt, path },
		];
		for (const repository of this.recentRepositories) {
			if (
				repository.path !== path &&
				recentRepositories.length < this.maxRecentRepositories
			) {
				recentRepositories.push(repository);
			}
		}
		this.recentRepositories = recentRepositories;
		this.persistRecentRepositories();
	}

	private loadRecentRepositories(): RecentRepositoryRecord[] {
		if (!this.recentRepositoryStore) {
			return [];
		}

		let repositories: readonly RecentRepositoryRecord[];
		try {
			repositories = this.recentRepositoryStore.load();
		} catch (error: unknown) {
			this.reportPersistenceError(error);
			return [];
		}

		const available = this.availableRecentRepositories(repositories);
		if (!sameRecentRepositories(repositories, available)) {
			this.persistRecentRepositories(available);
		}
		return available;
	}

	private availableRecentRepositories(
		repositories: readonly RecentRepositoryRecord[]
	): RecentRepositoryRecord[] {
		const available: RecentRepositoryRecord[] = [];
		const paths = new Set<string>();
		for (const repository of repositories) {
			if (available.length >= this.maxRecentRepositories) {
				break;
			}
			if (
				paths.has(repository.path) ||
				!isAbsolute(repository.path) ||
				!this.repositoryPathExists(repository.path)
			) {
				continue;
			}
			paths.add(repository.path);
			available.push({ ...repository });
		}
		return available;
	}

	private pruneUnavailableRecentRepositories(): void {
		const available = this.availableRecentRepositories(this.recentRepositories);
		if (sameRecentRepositories(this.recentRepositories, available)) {
			return;
		}
		this.recentRepositories = available;
		this.persistRecentRepositories();
	}

	private persistRecentRepositories(
		repositories: readonly RecentRepositoryRecord[] = this.recentRepositories
	): void {
		if (!this.recentRepositoryStore) {
			return;
		}
		try {
			this.recentRepositoryStore.save(repositories);
		} catch (error: unknown) {
			this.reportPersistenceError(error);
		}
	}

	private reportPersistenceError(error: unknown): void {
		const persistenceError =
			error instanceof Error
				? error
				: new Error(`Recent repository persistence failed: ${error}`);
		this.onPersistenceError?.(persistenceError);
	}
}
