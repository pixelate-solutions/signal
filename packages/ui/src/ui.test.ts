import { describe, expect, it } from "vitest";

import { signalColors, toneColors } from "./index.js";

describe("shared design tokens", () => {
  it("maps semantic status without losing contrast intent", () => {
    expect(toneColors("danger")).toEqual({
      foreground: signalColors.red,
      background: signalColors.redSoft,
    });
  });
});
