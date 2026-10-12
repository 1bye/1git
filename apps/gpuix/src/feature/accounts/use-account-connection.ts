import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceAuthorization } from "@1git/hosting/device-oauth";
import { NativeBrowser } from "../../platform/browser";
import { accountSetup, defaultAccountCallback } from "./lib/account-setup";
import type { Accounts } from "./lib/accounts";
import { AccountStore, type SavedAccount } from "./lib/account-store";

/** Shared connection lifecycle; credentials stay in refs and the OS vault, never renderer props. */
export function useAccountConnection({
	accounts,
	initialForm = "list",
	initialReconnectKey,
	openLink = NativeBrowser.open,
}: {
	accounts: Accounts;
	initialForm?: "list" | "connect";
	initialReconnectKey?: string;
	openLink?: (url: string) => Promise<void>;
}) {
	const [saved, setSaved] = useState<SavedAccount[]>([]);
	const [form, setForm] = useState<"list" | "connect">(initialForm);
	const [provider, setProvider] = useState<SavedAccount["provider"]>("github");
	const [webUrl, setWebUrl] = useState<string>(accountSetup.github.host);
	const [clientId, setClientId] = useState("");
	const [redirectUri, setRedirectUri] = useState(defaultAccountCallback);
	const [advanced, setAdvanced] = useState(false);
	const [manual, setManual] = useState(false);
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

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
			request.current?.abort();
			token.current = "";
		};
	}, []);

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
			setManual(false);
			setClientId("");
			setDevice(undefined);
			setRepositoryAccess(false);

			if (account)
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

	const changeMethod = (useToken: boolean) => {
		if (manual === useToken) return;

		setManual(useToken);
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

		const credential = token.current;

		token.current = "";
		setHasToken(false);
		setEditorVersion((version) => version + 1);

		void perform(async (signal) => {
			setWaiting(!manual);
			const next = manual
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

		setProvider(value);
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
