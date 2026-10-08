import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  const salt = token();
  const key = (await derive(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const key = (await derive(password, salt, 64)) as Buffer;
  const b = Buffer.from(expected, "hex");
  return key.length === b.length && timingSafeEqual(key, b);
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new HttpError(400, message);
}
export function text(value: unknown, max = 200) {
  requireValue(
    typeof value === "string" && value.length <= max,
    "Invalid text field",
  );
  return value as string;
}
export function uuid(value: unknown) {
  const s = text(value, 36);
  requireValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    ),
    "Invalid identifier",
  );
  return s;
}
