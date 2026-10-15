import sharp from "sharp";

/** Shared avatar/preview decoder runtime; bounds libvips caching without changing output pixels. */
export const imageProcessor = sharp;

imageProcessor.cache({ memory: 16, items: 32 });
