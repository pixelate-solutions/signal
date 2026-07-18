import { z } from "zod";

export const statusInputSchema = z.object({ resourceId: z.string().min(1).max(200) }).strict();
export const statusOutputSchema = z
  .object({
    resourceId: z.string(),
    status: z.enum(["pending", "ready", "failed"]),
    requestId: z.string(),
  })
  .strict();

export class ExampleStatusClient {
  public constructor(
    private readonly credential: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async read(rawInput: unknown, signal?: AbortSignal) {
    const input = statusInputSchema.parse(rawInput);
    const response = await this.fetcher(
      `https://sandbox.example.com/v1/resources/${encodeURIComponent(input.resourceId)}/status`,
      {
        headers: { authorization: `Bearer ${await this.credential()}`, accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.status === 401)
      throw new Error("CONNECTION_REQUIRED: Example authorization expired.");
    if (response.status === 429) throw new Error("RATE_LIMITED: Example API rate limit reached.");
    if (!response.ok) throw new Error(`PROVIDER_ERROR: Example API returned ${response.status}.`);
    return statusOutputSchema.parse(await response.json());
  }
}
