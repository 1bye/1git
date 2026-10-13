import { parseArgs } from "node:util";

/** Numeric bundle versions, without changing the development package version. */
export class ReleaseVersion {
	static parse(value: string): string {
		if (
			!/^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/u.test(
				value
			)
		)
			throw new Error(
				"Use a numeric major.minor.patch release version, for example 0.0.2."
			);

		return value;
	}

	static compare(left: string, right: string): number {
		const a = this.parse(left).split(".").map(Number);
		const b = this.parse(right).split(".").map(Number);

		for (let index = 0; index < 3; index++) {
			const difference = (a[index] ?? 0) - (b[index] ?? 0);

			if (difference !== 0) return Math.sign(difference);
		}

		return 0;
	}
}

/** Explicit command options; dry-run performs no R2 or public endpoint access. */
export type ReleaseOptions =
	| { help: true }
	| {
			help: false;
			version: string;
			dryRun: boolean;
			stage: string;
			profile?: string;
	  };

export function releaseOptions(args: string[]): ReleaseOptions {
	const { values } = parseArgs({
		args: args[0] === "--" ? args.slice(1) : args,
		strict: true,
		allowPositionals: false,
		options: {
			version: { type: "string" },
			stage: { type: "string", default: "prod" },
			profile: { type: "string" },
			"dry-run": { type: "boolean", default: false },
			help: { type: "boolean", default: false },
		},
	});

	if (values.help) return { help: true };

	if (!values.version)
		throw new Error("Provide --version, for example --version 0.0.2.");

	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(values.stage))
		throw new Error("Invalid release stage.");

	if (
		values.profile !== undefined &&
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(values.profile)
	)
		throw new Error("Invalid Alchemy profile name.");

	return {
		help: false,
		version: ReleaseVersion.parse(values.version),
		dryRun: values["dry-run"],
		stage: values.stage,
		...(values.profile ? { profile: values.profile } : {}),
	};
}
