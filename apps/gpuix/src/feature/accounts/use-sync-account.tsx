import { useCallback, useEffect, useRef, useState } from "react";
import { spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import { Popover, PopoverContent } from "@1git/gpuix-ui/popover";
import { appTokens } from "../../styles/tokens";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import type { ChooseRemoteAccount } from "./lib/remote-accounts";

interface PendingChoice {
	readonly remote: string;
	readonly url: string;
	readonly accounts: readonly SavedAccount[];
	readonly finish: (key: string | null) => void;
}

/** One window's queued, cancellable prompts contain only account metadata, never credentials. */
export function useSyncAccount() {
	const [pending, setPending] = useState<readonly PendingChoice[]>([]);
	const requests = useRef(new Set<PendingChoice>());
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		const active = requests.current;

		return () => {
			mounted.current = false;

			for (const request of active) request.finish(null);
		};
	}, []);

	const choose = useCallback<ChooseRemoteAccount>(
		(remote, url, accounts, signal) => {
			if (signal.aborted) return Promise.resolve(null);

			return new Promise((resolve) => {
				const cancel = () => request.finish(null);

				const request: PendingChoice = {
					remote,
					url,
					accounts,
					finish: (key) => {
						if (!requests.current.delete(request)) return;

						signal.removeEventListener("abort", cancel);

						if (mounted.current)
							setPending((previous) =>
								previous.filter((item) => item !== request)
							);

						resolve(key);
					},
				};

				requests.current.add(request);
				signal.addEventListener("abort", cancel, { once: true });
				setPending((previous) => [...previous, request]);
			});
		},
		[]
	);

	const current = pending[0];

	return {
		choose,
		dialog: current ? (
			<Popover
				open
				onOpenChange={(open) => {
					if (!open) current.finish(null);
				}}
			>
				<PopoverContent
					placement="center"
					width={340}
					tokens={appTokens}
					aria-label="Choose synchronization account"
					testId="sync-account-dialog"
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: spacing[2],
						}}
					>
						<text
							role="heading"
							aria-level={2}
							style={{ ...typography.lg, color: appTokens.colors.text }}
						>
							{`Account for ${current.remote}`}
						</text>
						<text
							style={{ ...typography.sm, color: appTokens.colors.textMuted }}
						>
							{new URL(current.url).host}
						</text>
						{current.accounts.map((account) => (
							<Button
								key={AccountStore.key(account)}
								testId={`sync-account-${account.id}`}
								tokens={appTokens}
								variant="secondary"
								onPress={() => current.finish(AccountStore.key(account))}
							>
								{account.username}
							</Button>
						))}
						<Button
							testId="sync-account-system"
							tokens={appTokens}
							variant="secondary"
							onPress={() => current.finish("system")}
						>
							Use system Git credentials
						</Button>
						<Button
							testId="sync-account-cancel"
							tokens={appTokens}
							variant="ghost"
							onPress={() => current.finish(null)}
						>
							Cancel
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		) : null,
	};
}
