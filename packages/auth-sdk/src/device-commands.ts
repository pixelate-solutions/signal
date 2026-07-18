import { randomBytes, randomUUID } from "node:crypto";

import nacl from "tweetnacl";

import {
  deviceCommandResultSchema,
  deviceCommandSchema,
  type DeviceCommand,
  type DeviceCommandResult,
} from "@signal/contracts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

const encode = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url");

export class DeviceCommandProtocol {
  readonly #serverKeys: nacl.SignKeyPair;
  readonly #deviceKeys = new Map<string, Uint8Array>();
  readonly #commands = new Map<string, DeviceCommand>();

  public constructor(seed: Uint8Array = randomBytes(nacl.sign.seedLength)) {
    this.#serverKeys = nacl.sign.keyPair.fromSeed(seed);
  }

  public get serverPublicKey(): string {
    return encode(this.#serverKeys.publicKey);
  }

  public registerDevice(deviceId: string, publicKey: string): void {
    const decoded = decode(publicKey);
    if (decoded.byteLength !== nacl.sign.publicKeyLength)
      throw new Error("Invalid device signing key.");
    this.#deviceKeys.set(deviceId, decoded);
  }

  public issue(
    input: Omit<
      DeviceCommand,
      "commandId" | "issuedAt" | "expiresAt" | "nonce" | "serverSignature"
    > & {
      ttlSeconds?: number;
    },
    now = new Date(),
  ): DeviceCommand {
    if (!this.#deviceKeys.has(input.deviceId))
      throw new Error("The target device is not registered.");
    const { ttlSeconds = 300, ...materialInput } = input;
    const material = {
      ...materialInput,
      commandId: `cmd_${randomUUID().replaceAll("-", "")}`,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      nonce: randomBytes(32).toString("base64url"),
    };
    const signature = nacl.sign.detached(
      Buffer.from(canonical(material)),
      this.#serverKeys.secretKey,
    );
    const command = deviceCommandSchema.parse({ ...material, serverSignature: encode(signature) });
    this.#commands.set(command.commandId, command);
    return command;
  }

  public verifyResult(rawResult: unknown): DeviceCommandResult {
    const result = deviceCommandResultSchema.parse(rawResult);
    const command = this.#commands.get(result.commandId);
    if (command === undefined) throw new Error("Device command is unknown or no longer active.");
    const publicKey = this.#deviceKeys.get(command.deviceId);
    if (publicKey === undefined) throw new Error("Device signing key is unavailable.");
    const { deviceSignature, ...material } = result;
    if (
      !nacl.sign.detached.verify(
        Buffer.from(canonical(material)),
        decode(deviceSignature),
        publicKey,
      )
    ) {
      throw new Error("Device result signature is invalid.");
    }
    if (new Date(result.completedAt) > new Date(command.expiresAt)) {
      throw new Error("Device result arrived after command expiry.");
    }
    this.#commands.delete(result.commandId);
    return result;
  }
}
