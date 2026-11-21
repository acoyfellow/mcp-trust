import { ed25519 } from "@noble/curves/ed25519.js";

export interface PassportFields {
  readonly provider: string;
  readonly serverUrl: string;
  readonly toolName: string;
  readonly schemaHash: string;
}

const encoder = new TextEncoder();

export const passportMessage = (fields: PassportFields): Uint8Array =>
  encoder.encode(
    JSON.stringify([fields.provider, fields.serverUrl, fields.toolName, fields.schemaHash]),
  );

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const verifyPassport = (
  publicKeyHex: string,
  signatureHex: string,
  fields: PassportFields,
): boolean => {
  const publicKey = fromHex(publicKeyHex);
  const signature = fromHex(signatureHex);
  if (publicKey === null || signature === null) return false;
  try {
    return ed25519.verify(signature, passportMessage(fields), publicKey);
  } catch {
    return false;
  }
};

export const signPassport = (secretKeyHex: string, fields: PassportFields): string => {
  const secretKey = fromHex(secretKeyHex);
  if (secretKey === null) throw new Error("secret key is not hex");
  return toHex(ed25519.sign(passportMessage(fields), secretKey));
};

export interface ProviderKey {
  readonly secretKey: string;
  readonly publicKey: string;
}

export const providerKeyFromSecret = (secretKeyHex: string): ProviderKey => {
  const secretKey = fromHex(secretKeyHex);
  if (secretKey === null) throw new Error("secret key is not hex");
  return { secretKey: secretKeyHex, publicKey: toHex(ed25519.getPublicKey(secretKey)) };
};

export const generateProviderKey = (): ProviderKey =>
  providerKeyFromSecret(toHex(ed25519.utils.randomSecretKey()));
