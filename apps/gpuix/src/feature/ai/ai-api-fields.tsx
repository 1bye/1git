import { useRef, useState } from "react";
import { radius, spacing, typography } from "@1git/design-tokens";
import { Button } from "@1git/gpuix-ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@1git/gpuix-ui/select";
import { useAppTheme } from "../../styles/theme";
import type { AiConnection } from "./lib/ai-settings-store";
import type { CustomApiConfiguration } from "./lib/custom-api";

const formats = [
	{ value: "openai-chat", label: "OpenAI Chat Completions" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic", label: "Claude Messages" },
] as const;

/** Manual API fields; secret values stay in uncontrolled inputs and local refs. */
export function AiApiFields({
	draft,
	onChange,
	onHeadersChange,
	connected,
	reconnect,
	busy,
}: {
	draft: AiConnection;
	onChange: (draft: AiConnection) => void;
	onHeadersChange: (raw: string) => void;
	connected: boolean;
	reconnect: boolean;
	busy: boolean;
}) {
	const { tokens } = useAppTheme();

	const configuration = draft.api ?? {
		protocol: "openai-chat",
		baseUrl: "https://api.openai.com/v1",
	};

	const [replacing, setReplacing] = useState(reconnect);

	const [rows, setRows] = useState([
		{
			id: 0,
			name:
				configuration.protocol === "anthropic" ? "x-api-key" : "Authorization",
		},
	]);

	const nextId = useRef(1);
	const values = useRef(new Map<number, string>());
	const label = { ...typography.md, color: tokens.colors.textMuted };

	const row = {
		display: "flex",
		flexDirection: "row",
		alignItems: "center",
		gap: spacing[2],
		flexShrink: 0,
	};

	const field = {
		width: "100%",
		height: tokens.layout.controlHeight,
		...typography.md,
		color: tokens.colors.text,
		backgroundColor: "transparent",
		borderWidth: 1,
		borderColor: tokens.colors.border,
		borderRadius: radius.md,
		paddingLeft: spacing[2.5],
		paddingRight: spacing[2.5],
		flexShrink: 0,
	};

	const updateHeaders = (nextRows: typeof rows) => {
		setRows(nextRows);
		onHeadersChange(
			JSON.stringify(
				nextRows
					.map(({ id, name }) => ({
						name,
						value: values.current.get(id) ?? "",
					}))
					.filter((header) => header.name || header.value)
			)
		);
	};

	const selectFormat = (protocol: CustomApiConfiguration["protocol"]) => {
		const defaultUrl =
			protocol === "anthropic"
				? "https://api.anthropic.com/v1"
				: "https://api.openai.com/v1";

		const baseUrl =
			configuration.baseUrl === "https://api.openai.com/v1" ||
			configuration.baseUrl === "https://api.anthropic.com/v1"
				? defaultUrl
				: configuration.baseUrl;

		if (
			!values.current.size &&
			rows.length === 1 &&
			(rows[0]?.name === "Authorization" || rows[0]?.name === "x-api-key")
		)
			setRows([
				{
					id: rows[0].id,
					name: protocol === "anthropic" ? "x-api-key" : "Authorization",
				},
			]);

		onChange({ ...draft, api: { protocol, baseUrl } });
	};

	return (
		<>
			<text style={label}>API format</text>
			<Select
				value={configuration.protocol}
				items={formats}
				disabled={busy}
				onValueChange={(value) => {
					const format = formats.find((item) => item.value === value);

					if (format) selectFormat(format.value);
				}}
			>
				<SelectTrigger
					testId="ai-api-format"
					aria-label="API format"
					tokens={tokens}
					style={{ width: "100%" }}
				>
					<SelectValue tokens={tokens} />
				</SelectTrigger>
				<SelectContent tokens={tokens}>
					{formats.map((format) => (
						<SelectItem key={format.value} value={format.value} tokens={tokens}>
							{format.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<text style={label}>Base URL</text>
			<input
				testId="ai-api-url"
				aria-label="API base URL"
				value={configuration.baseUrl}
				placeholder="https://your-provider.example/v1"
				readOnly={busy}
				onChange={(event) =>
					onChange({
						...draft,
						api: {
							...configuration,
							baseUrl: (event.value ?? "").slice(0, 2048),
						},
					})
				}
				style={field}
			/>
			<text
				style={{ ...typography.sm, color: tokens.colors.textMuted }}
			>{`Appends ${configuration.protocol === "anthropic" ? "/messages" : configuration.protocol === "openai-responses" ? "/responses" : "/chat/completions"} to this URL.`}</text>
			<div style={{ ...row, justifyContent: "space-between" }}>
				<text style={label}>Auth headers</text>
				{!connected || replacing ? (
					<Button
						testId="ai-api-header-add"
						tokens={tokens}
						size="sm"
						variant="ghost"
						disabled={busy || rows.length >= 16}
						onPress={() =>
							updateHeaders([...rows, { id: nextId.current++, name: "" }])
						}
					>
						Add header
					</Button>
				) : null}
			</div>
			{connected && !replacing ? (
				<div style={row}>
					<text style={label}>Headers saved securely.</text>
					<Button
						testId="ai-api-replace-headers"
						tokens={tokens}
						size="sm"
						variant="ghost"
						disabled={busy}
						onPress={() => {
							setReplacing(true);
							onHeadersChange("[]");
						}}
					>
						Replace headers
					</Button>
				</div>
			) : (
				<>
					{rows.map((header) => (
						<div key={header.id} style={row}>
							<input
								testId={`ai-api-header-name-${header.id}`}
								aria-label={`Auth header ${header.id + 1} name`}
								value={header.name}
								placeholder="Header name"
								readOnly={busy}
								onChange={(event) =>
									updateHeaders(
										rows.map((item) =>
											item.id === header.id
												? { ...item, name: (event.value ?? "").slice(0, 128) }
												: item
										)
									)
								}
								style={{ ...field, width: 132 }}
							/>
							<input
								testId={`ai-api-header-value-${header.id}`}
								aria-label={`Auth header ${header.id + 1} value`}
								type="password"
								placeholder={
									header.name.toLowerCase() === "authorization"
										? "Bearer your-api-key"
										: "Header value"
								}
								readOnly={busy}
								onChange={(event) => {
									values.current.set(header.id, event.value ?? "");
									updateHeaders(rows);
								}}
								style={{
									...field,
									width: undefined,
									flexGrow: 1,
									flexBasis: 0,
									minWidth: 0,
								}}
							/>
							<Button
								testId={`ai-api-header-remove-${header.id}`}
								aria-label={`Remove auth header ${header.id + 1}`}
								tokens={tokens}
								size="sm"
								variant="ghost"
								disabled={busy}
								onPress={() => {
									values.current.delete(header.id);
									updateHeaders(rows.filter((item) => item.id !== header.id));
								}}
							>
								Remove
							</Button>
						</div>
					))}
					<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
						Remove all headers if authentication is not needed.
					</text>
				</>
			)}
			<text style={label}>Model</text>
			<input
				testId="ai-api-model"
				aria-label="API model"
				value={draft.model}
				placeholder="Model ID from your provider"
				readOnly={busy}
				onChange={(event) =>
					onChange({ ...draft, model: (event.value ?? "").slice(0, 256) })
				}
				style={field}
			/>
			<text style={label}>Effort (optional)</text>
			<input
				testId="ai-api-effort"
				aria-label="API effort"
				value={draft.effort ?? ""}
				placeholder="Provider default"
				readOnly={busy}
				onChange={(event) =>
					onChange({ ...draft, effort: (event.value ?? "").slice(0, 32) })
				}
				style={field}
			/>
			<text style={{ ...typography.sm, color: tokens.colors.textMuted }}>
				Use an effort value supported by your model, such as medium or high.
			</text>
		</>
	);
}
