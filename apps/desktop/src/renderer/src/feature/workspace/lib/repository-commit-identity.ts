export interface RepositoryCommitIdentity {
	readonly email: string;
	readonly name: string;
}

export interface RepositoryCommitIdentityRequirement extends RepositoryCommitIdentity {
	readonly sessionId: string;
}

export const normalizeRepositoryCommitIdentity = (
	name: string | null,
	email: string | null
): RepositoryCommitIdentity => ({
	email: email?.trim() ?? "",
	name: name?.trim() ?? "",
});

export const hasRepositoryCommitIdentity = (
	identity: RepositoryCommitIdentity
): boolean => identity.name.length > 0 && identity.email.length > 0;

export type RepositoryCommitIdentityValueReader = (
	key: "user.email" | "user.name"
) => Promise<string | null>;

export const readRepositoryCommitIdentity = async (
	readValue: RepositoryCommitIdentityValueReader
): Promise<RepositoryCommitIdentity> => {
	const [name, email] = await Promise.all([
		readValue("user.name"),
		readValue("user.email"),
	]);

	return normalizeRepositoryCommitIdentity(name, email);
};

export const commitIdentityForSession = (
	requirement: RepositoryCommitIdentityRequirement | null,
	sessionId: string | null
): RepositoryCommitIdentityRequirement | null =>
	requirement?.sessionId === sessionId ? requirement : null;
