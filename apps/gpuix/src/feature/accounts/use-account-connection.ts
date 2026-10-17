import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceAuthorization } from "@1git/hosting/device-oauth";
import { NativeBrowser } from "../../platform/browser";
import { accountSetup, defaultAccountCallback } from "./lib/account-setup";
import type { Accounts } from "./lib/accounts";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import type { GitHubCliAccount } from "./lib/github-cli";

/** Available account connection methods; GitHub CLI is only offered for GitHub. */
export type AccountConnectionMethod = "browser" | "token" | "github-cli";

/** Shared connection lifecycle; credentials stay in refs and the OS vault, never renderer props. */
export function useAccountConnection({
	accounts,
	initialForm = "list",
	initialReconnectKey,
	preferGitHubCli = false,
	openLink = NativeBrowser.open,
}: {
	accounts: Accounts;
	initialForm?: "list" | "connect";
	initialReconnectKey?: string;
	/** Preselect signed-in CLI accounts for new GitHub connections during onboarding. */
	preferGitHubCli?: boolean;
	openLink?: (url: string) => Promise<void>;
}) {
	const [saved, setSaved] = useState<SavedAccount[]>([]);
	const [form, setForm] = useState<"list" | "connect">(initialForm);
	const [provider, setProvider] = useState<SavedAccount["provider"]>("github");
	const [webUrl, setWebUrl] = useState<string>(accountSetup.github.host);
	const [clientId, setClientId] = useState("");
	const [redirectUri, setRedirectUri] = useState(defaultAccountCallback);
	const [advanced, setAdvanced] = useState(false);
	const [method, setMethod] = useState<AccountConnectionMethod>("browser");
	const manual = method === "token";

	const [cliAccounts, setCliAccounts] = useState<readonly GitHubCliAccount[]>(
		[]
	);

	const [cliSelected, setCliSelected] = useState<GitHubCliAccount>();
	const [cliLoading, setCliLoading] = useState(false);
	const [cliError, setCliError] = useState<string>();
	const [cliRevision, setCliRevision] = useState(0);
	const [repositoryAccess, setRepositoryAccess] = useState(false);
	const [device, setDevice] = useState<DeviceAuthorization>();
	const [replacing, setReplacing] = useState<SavedAccount>();
	const [busy, setBusy] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<Record<string, string>>({});
	const [hasToken, setHasToken] = useState(false);
	const [editorVersion, setEditorVersion] = useState(0);
	const token = useRef("");
	const request = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const methodWasChosen = useRef(false);
	const preferCli = preferGitHubCli && !replacing;

	const discoverCli =
		form === "connect" &&
		provider === "github" &&
		(method === "github-cli" || preferCli);

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();
			token.current = "";
		};
	}, []);

	useEffect(() => {
		if (!discoverCli) return;

		const controller = new AbortController();

		setCliLoading(true);
		setCliSelected(undefined);
		setCliAccounts([]);
		setCliError(undefined);

		void (async () => {
			try {
				const found = await accounts.cliAccounts(controller.signal);

				if (!controller.signal.aborted) {
					setCliAccounts(found);
					setCliSelected(found.length === 1 ? found[0] : undefined);

					if (
						preferCli &&
						found.length &&
						!methodWasChosen.current &&
						!request.current
					)
						setMethod("github-cli");
				}
			} catch (cause) {
				if (!controller.signal.aborted)
					setCliError(
						cause instanceof Error
							? cause.message
							: "Could not discover GitHub CLI accounts."
					);
			} finally {
				if (!controller.signal.aborted) setCliLoading(false);
			}
		})();

		return () => controller.abort();
	}, [accounts, discoverCli, cliRevision, preferCli]);

	const perform = useCallback(
		async (operation: (signal: AbortSignal) => Promise<void>) => {
			if (request.current) return;

			const controller = new AbortController();

			request.current = controller;
			setBusy(true);
			setError(undefined);

			try {
				await operation(controller.signal);
			} catch (cause) {
				if (mounted.current && !controller.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : "Account action failed."
					);
			} finally {
				request.current = null;

				if (mounted.current) {
					setBusy(false);
					setWaiting(false);
					setDevice(undefined);
				}
			}
		},
		[]
	);

	const startConnection = useCallback(
		(
			account?: SavedAccount,
			selectedProvider: SavedAccount["provider"] = "github"
		) => {
			if (request.current) return;

			methodWasChosen.current = !!account;
			setReplacing(account);
			setProvider(account?.provider ?? selectedProvider);
			setWebUrl(account?.webUrl ?? accountSetup[selectedProvider].host);
			setAdvanced(
				!!account &&
					account.webUrl !== new URL(accountSetup[account.provider].host).href
			);
			setRedirectUri(defaultAccountCallback);
			setError(undefined);
			token.current = "";
			setHasToken(false);
			setForm("connect");
			setMethod(
				account?.credentialSource === "github-cli" ? "github-cli" : "browser"
			);
			setClientId("");
			setDevice(undefined);
			setRepositoryAccess(false);

			if (account && account.credentialSource !== "github-cli")
				void perform(async () => {
					const [registration, access] = await Promise.all([
						accounts.registration(account),
						accounts.repositoryAccess(account),
					]);

					if (!mounted.current) return;

					setRepositoryAccess(access === true);

					if (registration) {
						setClientId(registration.clientId);
						setRedirectUri(registration.redirectUri ?? defaultAccountCallback);
					}
				});
		},
		[accounts, perform]
	);

	useEffect(() => {
		token.current = "";
		setHasToken(false);
		setForm(initialForm);
		setError(undefined);
		setStatus({});

		try {
			const loaded = accounts.load();

			setSaved(loaded);
			const reconnect = loaded.find(
				(account) => AccountStore.key(account) === initialReconnectKey
			);

			if (reconnect) startConnection(reconnect);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not load accounts."
			);
		}
	}, [accounts, initialForm, initialReconnectKey, startConnection]);

	const changeMethod = (next: AccountConnectionMethod) => {
		if (busy || (next === "github-cli" && provider !== "github")) return;

		methodWasChosen.current = true;

		if (method === next) return;

		setMethod(next);
		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);
		setError(undefined);
	};

	const openSetupLink = async (url: string) => {
		try {
			await openLink(url);
		} catch {
			if (mounted.current)
				setError("Could not open the setup page in your browser. Try again.");
		}
	};

	const connect = () => {
		if (request.current) return;

		methodWasChosen.current = true;
		const credential = token.current;

		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);

		void perform(async (signal) => {
			setWaiting(method !== "token");
			let next: SavedAccount[];

			if (method === "github-cli") {
				if (!cliSelected) throw new Error("Choose a GitHub CLI account.");

				next = await accounts.connectCli(cliSelected, { replacing, signal });
			} else {
				next = manual
					? await accounts.connect({
							provider,
							webUrl,
							token: credential,
							replacing,
							signal,
						})
					: await accounts.connectBrowser({
							provider,
							webUrl,
							repositoryAccess,
							registration: {
								clientId: clientId.trim(),
								redirectUri:
									provider === "gitlab" ? redirectUri.trim() : undefined,
							},
							replacing,
							signal,
							onDeviceCode: (code) => {
								if (mounted.current && !signal.aborted) setDevice(code);
							},
							onAuthorized: () => {
								if (mounted.current) {
									setWaiting(false);
									setDevice(undefined);
								}
							},
						});
			}

			if (!mounted.current) return;

			setSaved(next);
			setForm("list");
			const connected = next.at(-1);

			if (connected)
				setStatus((previous) => ({
					...previous,
					[AccountStore.key(connected)]: "Connected",
				}));
		});
	};

	const clearToken = useCallback(() => {
		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);
	}, []);

	const setToken = (value: string) => {
		token.current = value;
		setHasToken(!!value);
	};

	const changeProvider = (value: SavedAccount["provider"]) => {
		if (busy || replacing || value === provider) return;

		methodWasChosen.current = false;
		setProvider(value);
		setMethod((current) => (current === "github-cli" ? "browser" : current));
		setClientId("");
		setWebUrl(accountSetup[value].host);
		setRedirectUri(defaultAccountCallback);
		setAdvanced(false);
		clearToken();
		setError(undefined);
	};

	const cancelConnection = useCallback(() => {
		if (request.current) {
			if (waiting) request.current.abort();

			return true;
		}

		if (form !== "connect") return false;

		clearToken();
		setClientId("");
		setError(undefined);
		setForm("list");

		return true;
	}, [clearToken, form, waiting]);

	return {
		saved,
		setSaved,
		form,
		setForm,
		provider,
		webUrl,
		setWebUrl,
		clientId,
		setClientId,
		redirectUri,
		setRedirectUri,
		advanced,
		setAdvanced,
		manual,
		method,
		cliAccounts,
		cliSelected,
		setCliSelected,
		cliLoading,
		cliError,
		refreshCli: () => setCliRevision((revision) => revision + 1),
		repositoryAccess,
		setRepositoryAccess,
		device,
		replacing,
		busy,
		waiting,
		error,
		setError,
		status,
		setStatus,
		hasToken,
		editorVersion,
		perform,
		startConnection,
		changeMethod,
		changeProvider,
		openSetupLink,
		connect,
		setToken,
		clearToken,
		cancelConnection,
		isPending: () => request.current !== null,
	};
}

export type AccountConnection = ReturnType<typeof useAccountConnection>;
