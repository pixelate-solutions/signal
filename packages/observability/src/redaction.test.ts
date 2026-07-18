import { describe, expect, it } from "vitest";

import { REDACTED, redact } from "./index.js";

describe("central redaction", () => {
  it("redacts secret field names recursively", () => {
    expect(redact({ provider: { refresh_token: "very-secret-value" } })).toEqual({
      provider: { refresh_token: REDACTED },
    });
  });

  it("redacts bearer values in free text", () => {
    expect(redact("Authorization failed for Bearer abcdefghijklmnopqrstuvwxyz")).not.toContain(
      "abcdefghijklmnopqrstuvwxyz",
    );
  });
});
