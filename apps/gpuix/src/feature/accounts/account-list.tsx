import { Button } from "@1git/gpuix-ui/button";
import { appTokens } from "../../styles/tokens";
import { AccountStore, type SavedAccount } from "./lib/account-store";
import { accountSetup } from "./lib/account-setup";
import { accountProviderIcons } from "./account-provider-icons";

// Phosphor Icons 2.1.10, Light weight. See ../../../LICENSES/Phosphor-Icons.txt.
const actionIcons = {
	check:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M238,56v48a6,6,0,0,1-6,6H184a6,6,0,0,1,0-12h32.55l-30.38-27.8c-.06-.06-.12-.13-.19-.19a82,82,0,1,0-1.7,117.65,6,6,0,0,1,8.24,8.73A93.46,93.46,0,0,1,128,222h-1.28A94,94,0,1,1,194.37,61.4L226,90.35V56a6,6,0,1,1,12,0Z"/></svg>',
	reconnect:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M225.9,74.78,181.21,30.09a14,14,0,0,0-19.8,0L38.1,153.41a13.94,13.94,0,0,0-4.1,9.9V208a14,14,0,0,0,14,14H92.69a13.94,13.94,0,0,0,9.9-4.1L225.9,94.58a14,14,0,0,0,0-19.8ZM94.1,209.41a2,2,0,0,1-1.41.59H48a2,2,0,0,1-2-2V163.31a2,2,0,0,1,.59-1.41L136,72.48,183.51,120ZM217.41,86.1,192,111.51,144.49,64,169.9,38.58a2,2,0,0,1,2.83,0l44.68,44.69a2,2,0,0,1,0,2.83Z"/></svg>',
	remove:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M216,50H174V40a22,22,0,0,0-22-22H104A22,22,0,0,0,82,40V50H40a6,6,0,0,0,0,12H50V208a14,14,0,0,0,14,14H192a14,14,0,0,0,14-14V62h10a6,6,0,0,0,0-12ZM94,40a10,10,0,0,1,10-10h48a10,10,0,0,1,10,10V50H94ZM194,208a2,2,0,0,1-2,2H64a2,2,0,0,1-2-2V62H194ZM110,104v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Zm48,0v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Z"/></svg>',
};

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
				const identity = `${account.username} on ${host.host}${host.pathname === "/" ? "" : host.pathname}`;

				const actions = [
					{
						name: "check",
						label: `Check connection for ${identity}`,
						onPress: onCheck,
					},
					{
						name: "reconnect",
						label: `Reconnect ${identity}`,
						onPress: onReconnect,
					},
					{ name: "remove", label: `Remove ${identity}`, onPress: onRemove },
				] as const;

				return (
					<div
						key={key}
						testId={`account-${key}`}
						role="group"
						aria-label={`${account.username} · ${accountSetup[account.provider].name}`}
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 12,
							flexShrink: 0,
						}}
					>
						<svg
							testId={`account-provider-icon-${key}`}
							aria-hidden
							source={accountProviderIcons[account.provider]}
							style={{
								width: 22,
								height: 22,
								flexShrink: 0,
								color: appTokens.colors.textMuted,
								pointerEvents: "none",
							}}
						/>
						<div
							testId={`account-info-${key}`}
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 2,
								flexGrow: 1,
								flexBasis: 0,
								minWidth: 0,
							}}
						>
							<text
								testId={`account-name-${key}`}
								style={{ fontSize: 12, color: appTokens.colors.text }}
							>
								{account.username}
							</text>
							<text
								testId={`account-status-${key}`}
								style={{ fontSize: 11, color: appTokens.colors.textMuted }}
							>
								{`${host.host}${host.pathname === "/" ? "" : host.pathname} · ${status[key] ?? "Not checked"}`}
							</text>
						</div>
						<div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
							{actions.map((action) => (
								<Button
									key={action.name}
									size="sm"
									variant="ghost"
									tokens={appTokens}
									disabled={disabled}
									aria-label={action.label}
									testId={`account-${action.name}-${key}`}
									style={{
										width: 26,
										height: 26,
										paddingLeft: 0,
										paddingRight: 0,
									}}
									onPress={() => action.onPress(account)}
								>
									<svg
										testId={`account-${action.name}-icon-${key}`}
										aria-hidden
										source={actionIcons[action.name]}
										style={{
											width: 14,
											height: 14,
											pointerEvents: "none",
											color:
												action.name === "remove"
													? appTokens.colors.danger
													: appTokens.colors.textMuted,
										}}
									/>
								</Button>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
