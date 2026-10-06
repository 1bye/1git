import { useState } from "react";
import { spacing, typography } from "@1git/design-tokens";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@1git/gpuix-ui/select";
import { AccountStore } from "../accounts/lib/account-store";
import type { RemoteAccounts } from "../accounts/lib/remote-accounts";
import { appTokens } from "../../styles/tokens";

/** Explicit authentication override for one destination; changing it never edits Git author settings. */
export function RemoteAccountSelect({
	bindings,
	directory,
	remote,
	url,
	disabled,
	label = "Account",
}: {
	bindings: RemoteAccounts;
	directory: string;
	remote: string;
	url: string;
	disabled: boolean;
	label?: string;
}) {
	const [state, setState] = useState(() => {
		try {
			return {
				choice: bindings.choice(directory, remote, url),
				accounts: bindings.matching(url),
				error: "",
			};
		} catch {
			return {
				choice: "automatic",
				accounts: [],
				error: "Could not read remote account settings.",
			};
		}
	});

	const options = [
		{
			value: "automatic",
			label: `Automatic${state.accounts.length === 1 ? ` · ${state.accounts[0]?.username}` : ""}`,
		},
		{ value: "system", label: "System Git credentials" },
		...state.accounts.map((account) => ({
			value: AccountStore.key(account),
			label: account.username,
		})),
	];

	if (!options.some((item) => item.value === state.choice))
		options.push({ value: state.choice, label: "Account unavailable" });

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
			<text style={{ ...typography.sm, color: appTokens.colors.textMuted }}>
				{label}
			</text>
			<Select
				value={state.choice}
				items={options}
				disabled={disabled}
				onValueChange={(value) => {
					if (!value || disabled) return;

					try {
						bindings.select(directory, remote, url, value);
						setState((previous) => ({ ...previous, choice: value, error: "" }));
					} catch {
						setState((previous) => ({
							...previous,
							error:
								"Could not save the account choice. Nothing was synchronized.",
						}));
					}
				}}
			>
				<SelectTrigger
					tokens={appTokens}
					testId={`remote-account-${remote}`}
					aria-label={`Authentication for ${remote}: ${url}`}
				>
					<SelectValue tokens={appTokens} />
				</SelectTrigger>
				<SelectContent tokens={appTokens}>
					{options.map((option) => (
						<SelectItem
							key={option.value}
							value={option.value}
							tokens={appTokens}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{state.error ? (
				<text
					role="alert"
					style={{ ...typography.sm, color: appTokens.colors.danger }}
				>
					{state.error}
				</text>
			) : null}
		</div>
	);
}
