/** Cloudflare R2 object keys are limited by UTF-8 bytes, not JS characters. */
export const MAX_R2_OBJECT_KEY_BYTES = 1_024;

const encoder = new TextEncoder();

export function physicalObjectKeyFits(
  ownedPrefix: string,
  relativeKey: string,
): boolean {
  return (
    encoder.encode(ownedPrefix).byteLength +
      encoder.encode(relativeKey).byteLength <=
    MAX_R2_OBJECT_KEY_BYTES
  );
}
