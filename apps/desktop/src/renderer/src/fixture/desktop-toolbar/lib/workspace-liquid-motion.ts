export interface WorkspaceLiquidMeasurement {
	readonly surfaceWidth: number;
	readonly tabLeft: number;
	readonly tabTop: number;
	readonly tabWidth: number;
}

const EASING_CONTROL_POINT_1_X = 0.22;
const EASING_CONTROL_POINT_2_X = 0.36;
const EASING_CONTROL_POINT_1_Y = 1;
const EASING_CONTROL_POINT_2_Y = 1;
const EASING_ITERATIONS = 6;
const MINIMUM_EASING_DERIVATIVE = 0.000_001;

const clampProgress = (progress: number): number =>
	Math.max(0, Math.min(1, progress));

const sampleCubicBezier = (
	progress: number,
	firstControlPoint: number,
	secondControlPoint: number
): number => {
	const inverseProgress = 1 - progress;
	return (
		3 * inverseProgress ** 2 * progress * firstControlPoint +
		3 * inverseProgress * progress ** 2 * secondControlPoint +
		progress ** 3
	);
};

const sampleCubicBezierDerivative = (
	progress: number,
	firstControlPoint: number,
	secondControlPoint: number
): number => {
	const inverseProgress = 1 - progress;
	return (
		3 * inverseProgress ** 2 * firstControlPoint +
		6 * inverseProgress * progress * (secondControlPoint - firstControlPoint) +
		3 * progress ** 2 * (1 - secondControlPoint)
	);
};

const interpolate = (start: number, end: number, progress: number): number =>
	start + (end - start) * progress;

export const createCollapsedWorkspaceLiquidMeasurement = (
	measurement: WorkspaceLiquidMeasurement
): WorkspaceLiquidMeasurement => ({
	...measurement,
	tabLeft: measurement.tabLeft + measurement.tabWidth / 2,
	tabWidth: 0,
});

export const easeWorkspaceLiquidMotion = (progress: number): number => {
	const normalizedProgress = clampProgress(progress);
	let curveProgress = normalizedProgress;

	for (let iteration = 0; iteration < EASING_ITERATIONS; iteration += 1) {
		const horizontalError =
			sampleCubicBezier(
				curveProgress,
				EASING_CONTROL_POINT_1_X,
				EASING_CONTROL_POINT_2_X
			) - normalizedProgress;
		const horizontalDerivative = sampleCubicBezierDerivative(
			curveProgress,
			EASING_CONTROL_POINT_1_X,
			EASING_CONTROL_POINT_2_X
		);
		if (Math.abs(horizontalDerivative) < MINIMUM_EASING_DERIVATIVE) {
			break;
		}
		curveProgress = clampProgress(
			curveProgress - horizontalError / horizontalDerivative
		);
	}

	return sampleCubicBezier(
		curveProgress,
		EASING_CONTROL_POINT_1_Y,
		EASING_CONTROL_POINT_2_Y
	);
};

export const interpolateWorkspaceLiquidMeasurement = (
	start: WorkspaceLiquidMeasurement,
	end: WorkspaceLiquidMeasurement,
	progress: number
): WorkspaceLiquidMeasurement => {
	const normalizedProgress = clampProgress(progress);
	return {
		surfaceWidth: end.surfaceWidth,
		tabLeft: interpolate(start.tabLeft, end.tabLeft, normalizedProgress),
		tabTop: interpolate(start.tabTop, end.tabTop, normalizedProgress),
		tabWidth: interpolate(start.tabWidth, end.tabWidth, normalizedProgress),
	};
};
