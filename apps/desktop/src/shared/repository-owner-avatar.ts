export const REPOSITORY_OWNER_IPC_CHANNELS = {
	avatar: "repository-owners:avatar",
} as const;

export interface RepositoryOwnerAvatarRequest {
	readonly host: string;
	readonly name: string;
}

export type RepositoryOwnerAvatarResult =
	| {
			readonly dataUrl: string;
			readonly status: "available";
	  }
	| {
			readonly status: "unavailable";
	  };

export interface RepositoryOwnerApi {
	readonly avatar: (
		request: RepositoryOwnerAvatarRequest
	) => Promise<RepositoryOwnerAvatarResult>;
}
