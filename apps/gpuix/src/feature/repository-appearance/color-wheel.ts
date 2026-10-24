/** Picker coordinates: hue in degrees, saturation and brightness between zero and one. */
export interface WheelColor {
	readonly hue: number;
	readonly saturation: number;
	readonly brightness: number;
}

/** Color conversion and a fixed RGBA wheel for the native image renderer. */
export class ColorWheel {
	static clamp(value: number): number {
		return Math.max(0, Math.min(1, value));
	}

	static fromHex(hex: string, previousHue = 0): WheelColor {
		const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
			(offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
		);

		const brightest = Math.max(red, green, blue);
		const range = brightest - Math.min(red, green, blue);
		let hue = previousHue;

		if (range > 0) {
			if (brightest === red) hue = ((green - blue) / range) % 6;
			else if (brightest === green) hue = (blue - red) / range + 2;
			else hue = (red - green) / range + 4;

			hue = (hue * 60 + 360) % 360;
		}

		return {
			hue,
			saturation: brightest === 0 ? 0 : range / brightest,
			brightness: brightest,
		};
	}

	static rgb(color: WheelColor): readonly [number, number, number] {
		const hue = ((color.hue % 360) + 360) % 360;
		const saturation = ColorWheel.clamp(color.saturation);
		const brightness = ColorWheel.clamp(color.brightness);

		const channel = (offset: number): number => {
			const position = (offset + hue / 60) % 6;

			return Math.round(
				255 *
					brightness *
					(1 - saturation * Math.max(0, Math.min(position, 4 - position, 1)))
			);
		};

		return [channel(5), channel(3), channel(1)];
	}

	static hex(color: WheelColor): string {
		return `#${ColorWheel.rgb(color)
			.map((channel) => channel.toString(16).padStart(2, "0"))
			.join("")}`;
	}

	/** Normalized coordinates put red on the right and clamp drags to the circle. */
	static atPoint(x: number, y: number, brightness: number): WheelColor {
		return {
			hue: ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360,
			saturation: ColorWheel.clamp(Math.hypot(x, y)),
			brightness,
		};
	}

	static pixels(size: number): Buffer {
		const pixels = Buffer.alloc(size * size * 4);
		const center = size / 2;
		const radius = center - 1;

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const dx = x + 0.5 - center;
				const dy = y + 0.5 - center;
				const distance = Math.hypot(dx, dy);
				const alpha = ColorWheel.clamp(radius + 0.5 - distance);

				if (alpha === 0) continue;

				const [red, green, blue] = ColorWheel.rgb(
					ColorWheel.atPoint(dx / radius, dy / radius, 1)
				);

				const offset = (y * size + x) * 4;

				pixels[offset] = red;
				pixels[offset + 1] = green;
				pixels[offset + 2] = blue;
				pixels[offset + 3] = Math.round(alpha * 255);
			}
		}

		return pixels;
	}
}
