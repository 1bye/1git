import { fontWeight, spacing, typography } from "@1git/design-tokens";
import type { PublicInstance } from "@gpuix/react";
import type { Ref } from "react";
import { useAppTheme } from "../../styles/theme";
import {
	AccountConnectionFields,
	AccountConnectionActions,
} from "../accounts/account-connection-form";
import { accountSetup } from "../accounts/lib/account-setup";
import type { AccountConnection } from "../accounts/use-account-connection";

/** Settings-style editor with its own scroll area and pinned authentication actions. */
export function OnboardingAccountForm({
	connection,
	ref,
}: {
	connection: AccountConnection;
	ref: Ref<PublicInstance>;
}) {
	const { tokens } = useAppTheme();

	return (
		<div
			ref={ref}
			testId="onboarding-account-panel"
			role="region"
			aria-label={`Add ${accountSetup[connection.provider].name} account`}
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				flexBasis: 0,
				minWidth: 0,
				minHeight: 0,
				paddingLeft: spacing[5],
				borderLeftWidth: 1,
				borderColor: tokens.colors.border,
			}}
		>
			<text
				role="heading"
				aria-level={2}
				style={{
					...typography.xl,
					fontWeight: fontWeight.medium,
					color: tokens.colors.text,
					marginBottom: spacing[5],
					flexShrink: 0,
				}}
			>{`Add ${accountSetup[connection.provider].name} account`}</text>
			<div
				testId="onboarding-account-scroll"
				style={{
					flexGrow: 1,
					minHeight: 0,
					minWidth: 0,
					overflowY: "scroll",
					paddingBottom: spacing[4],
				}}
			>
				<AccountConnectionFields
					connection={connection}
					providerChoices={<></>}
					maxWidth="100%"
				/>
			</div>
			<div
				testId="onboarding-account-actions"
				style={{
					flexShrink: 0,
					paddingTop: spacing[3],
					borderTopWidth: 1,
					borderColor: tokens.colors.border,
				}}
			>
				<AccountConnectionActions connection={connection} maxWidth="100%" />
			</div>
		</div>
	);
}
