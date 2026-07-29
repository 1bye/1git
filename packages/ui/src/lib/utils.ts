import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional classes and resolves conflicting Tailwind utilities. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
