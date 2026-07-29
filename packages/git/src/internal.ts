import type { RepositoryInfo } from "./contracts.js";
import type { GitProcess } from "./process/git-process.js";

/** Internal dependencies shared by repository-owned operations. */
export interface RepositoryContext {
	readonly process: GitProcess;
	readonly repository: RepositoryInfo;
}
