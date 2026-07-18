import { describe, expect, it } from "vitest";

import { reviewedAndroidIntent, reviewedAppIntentUrl } from "./intent-policy";

describe("reviewed device intent policy", () => {
  it("allows declared app integrations and rejects arbitrary custom schemes", () => {
    expect(reviewedAppIntentUrl("mailto:person@example.com?subject=Signal")).toContain("mailto:");
    expect(() => reviewedAppIntentUrl("private-bank-app://transfer?amount=1000")).toThrow(
      "not declared",
    );
    expect(() => reviewedAppIntentUrl("https://user:secret@example.com")).toThrow(
      "embedded credentials",
    );
  });

  it("binds Android actions to reviewed URL schemes", () => {
    expect(
      reviewedAndroidIntent({
        action: "android.intent.action.DIAL",
        url: "tel:+15555550100",
        managedEnterprise: false,
      }),
    ).toMatchObject({ action: "android.intent.action.DIAL", data: "tel:+15555550100" });
    expect(() =>
      reviewedAndroidIntent({
        action: "android.intent.action.DIAL",
        url: "https://example.com",
        managedEnterprise: false,
      }),
    ).toThrow("not allowed");
  });

  it("keeps managed settings intents out of the consumer build", () => {
    expect(() =>
      reviewedAndroidIntent({
        action: "android.settings.WIFI_SETTINGS",
        url: "",
        managedEnterprise: false,
      }),
    ).toThrow("not declared");
    expect(
      reviewedAndroidIntent({
        action: "android.settings.WIFI_SETTINGS",
        url: "",
        managedEnterprise: true,
      }),
    ).toEqual({ action: "android.settings.WIFI_SETTINGS" });
  });
});
