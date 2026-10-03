import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "../../styles/tokens";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import { accountSetup } from "./lib/account-setup";

// Original account-card illustration using the app's thin monochrome vector style.
const emptyArtwork =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 112" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="42" y="16" width="76" height="80" rx="10"/><circle cx="80" cy="43" r="10"/><path d="M62 70c0-10 8-17 18-17s18 7 18 17M66 82h28"/><rect x="10" y="36" width="20" height="40" rx="5"/><rect x="130" y="36" width="20" height="40" rx="5"/><path d="M30 56h12m76 0h12" stroke-dasharray="2 4"/><path d="M17 47h6m114 0h6M17 65h6m114 0h6M75 6h10m-10 100h10"/></svg>';

/** Saved identities remain mounted while a separate pane handles connection setup. */
export function AccountList({
	accounts,
	status,
	disabled,
	onCheck,
	onReconnect,
	onRemove,
}: {
	accounts: SavedAccount[];
	status: Record<string, string>;
	disabled: boolean;
	onCheck: (account: SavedAccount) => void;
	onReconnect: (account: SavedAccount) => void;
	onRemove: (account: SavedAccount) => void;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 20,
				flexGrow: 1,
				flexShrink: 0,
			}}
		>
			{!accounts.length ? (
				<div
					testId="accounts-empty"
					style={{
						display: "flex",
						flexDirection: "column",
						flexGrow: 1,
						alignItems: "center",
						justifyContent: "center",
						padding: 16,
					}}
				>
					<div
						testId="accounts-empty-content"
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 8,
						}}
					>
						<svg
							testId="accounts-empty-artwork"
							aria-hidden
							source={emptyArtwork}
							style={{
								width: 160,
								height: 112,
								flexShrink: 0,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						<text
							role="heading"
							aria-level={2}
							style={{
								fontSize: 13,
								fontWeight: 500,
								color: appTokens.colors.text,
							}}
						>
							No accounts connected.
						</text>
						<text
							style={{
								fontSize: 11,
								color: appTokens.colors.textMuted,
								textAlign: "center",
							}}
						>
							Add an account to connect your hosting provider.
						</text>
					</div>
				</div>
			) : null}
			{accounts.map((account) => {
				const key = AccountStore.key(account);
				const host = new URL(account.webUrl);

				return (
					<div
						key={key}
						testId={`account-${key}`}
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 5,
							flexShrink: 0,
						}}
					>
						<text style={{ fontSize: 12, color: appTokens.colors.text }}>
							{`${account.username} · ${accountSetup[account.provider].name}`}
						</text>
						<text style={{ fontSize: 11, color: appTokens.colors.textMuted }}>
							{`${host.host}${host.pathname === "/" ? "" : host.pathname} · ${status[key] ?? "Not checked"}`}
						</text>
						<div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
							<Button
								size="sm"
								variant="secondary"
								tokens={appTokens}
								disabled={disabled}
								testId={`account-check-${key}`}
								onPress={() => onCheck(account)}
							>
								Check
							</Button>
							<Button
								size="sm"
								variant="ghost"
								tokens={appTokens}
								disabled={disabled}
								testId={`account-reconnect-${key}`}
								onPress={() => onReconnect(account)}
							>
								Reconnect
							</Button>
							<Button
								size="sm"
								variant="ghost"
								tokens={appTokens}
								disabled={disabled}
								testId={`account-remove-${key}`}
								onPress={() => onRemove(account)}
							>
								Remove
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
