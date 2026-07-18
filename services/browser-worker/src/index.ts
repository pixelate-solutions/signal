import { createHash, randomUUID } from "node:crypto";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";
import { z } from "zod";

import { sha256 } from "@signal/event-sdk";
import { redact } from "@signal/observability";

import { assertSafeBrowserUrl, detectPromptInjection } from "./security.js";

export const browserModeSchema = z.enum(["autonomous", "observed", "approval", "takeover"]);
export const browserStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.url() }).strict(),
  z
    .object({
      action: z.literal("click"),
      selector: z.string().min(1),
      finalAction: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      selector: z.string().min(1),
      valueHandle: z.string().min(8),
    })
    .strict(),
  z
    .object({
      action: z.literal("upload"),
      selector: z.string().min(1),
      artifactId: z.string().min(8),
    })
    .strict(),
  z
    .object({
      action: z.literal("wait"),
      selector: z.string().min(1),
      timeoutMs: z.int().min(1).max(60_000),
    })
    .strict(),
  z.object({ action: z.literal("screenshot"), label: z.string().min(1) }).strict(),
]);

export type BrowserStep = z.infer<typeof browserStepSchema>;
export type BrowserEvidence = {
  id: string;
  url: string;
  capturedAt: string;
  screenshotDigest: string | null;
  accessibilityDigest: string;
  confirmationId: string | null;
  postActionSummary: string;
};

export interface BrowserEngine {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  upload(selector: string, path: string): Promise<void>;
  wait(selector: string, timeoutMs: number): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  accessibilityText(): Promise<string>;
  contentText(): Promise<string>;
  currentUrl(): Promise<string>;
  storageState?(): Promise<string>;
  drainDownloads?(): Promise<{ fileName: string; bytes: Uint8Array; mimeType: string }[]>;
  close(): Promise<void>;
}

export type BrowserAudit = {
  event(type: string, detail: Record<string, unknown>): Promise<void>;
};

export type BrowserLifecycle = {
  resolveArtifact?: (artifactId: string) => Promise<string>;
  persistSession?: (storageState: string) => Promise<void>;
  captureEvidence?: (evidence: BrowserEvidence, screenshot: Uint8Array) => Promise<void>;
  captureDownload?: (download: {
    fileName: string;
    bytes: Uint8Array;
    mimeType: string;
  }) => Promise<string>;
};

export class BrowserOperator {
  public constructor(
    private readonly engine: BrowserEngine,
    private readonly resolveSecret: (handle: string) => Promise<string>,
    private readonly audit: BrowserAudit,
    private readonly lifecycle: BrowserLifecycle = {},
    private readonly requireTls = false,
  ) {}

  public async execute(input: {
    tenantId: string;
    taskId: string;
    allowlist: string[];
    mode: z.infer<typeof browserModeSchema>;
    steps: unknown[];
    approvedFinalActionDigest?: string;
  }): Promise<{
    status: "SUCCEEDED" | "TAKEOVER_REQUIRED" | "MFA_REQUIRED";
    evidence: BrowserEvidence[];
    artifactIds: string[];
    completedSteps: number;
  }> {
    const mode = browserModeSchema.parse(input.mode);
    const steps = input.steps.map((step) => browserStepSchema.parse(step));
    const evidence: BrowserEvidence[] = [];
    const artifactIds: string[] = [];
    let completedSteps = 0;
    const captureCurrentState = async (): Promise<BrowserEvidence> => {
      const screenshot = await this.engine.screenshot();
      const accessibility = await this.engine.accessibilityText();
      const captured: BrowserEvidence = {
        id: `evd_${randomUUID().replaceAll("-", "")}`,
        url: await this.engine.currentUrl(),
        capturedAt: new Date().toISOString(),
        screenshotDigest:
          screenshot.byteLength === 0
            ? null
            : `sha256:${createHash("sha256").update(screenshot).digest("hex")}`,
        accessibilityDigest: `sha256:${createHash("sha256").update(accessibility).digest("hex")}`,
        confirmationId: null,
        postActionSummary: String(
          (redact({ summary: accessibility.slice(0, 500) }) as { summary: string }).summary,
        ),
      };
      evidence.push(captured);
      await this.lifecycle.captureEvidence?.(captured, screenshot);
      const downloads = (await this.engine.drainDownloads?.()) ?? [];
      for (const download of downloads) {
        const artifactId = await this.lifecycle.captureDownload?.(download);
        if (artifactId !== undefined) artifactIds.push(artifactId);
      }
      return captured;
    };
    try {
      for (const step of steps) {
        if (step.action === "navigate") {
          const safe = await assertSafeBrowserUrl(
            step.url,
            input.allowlist,
            undefined,
            this.requireTls,
          );
          await this.engine.navigate(safe.toString());
        } else if (step.action === "fill") {
          const value = await this.resolveSecret(step.valueHandle);
          await this.engine.fill(step.selector, value);
        } else if (step.action === "click") {
          if (step.finalAction) {
            const digest = sha256({ taskId: input.taskId, action: step });
            if (input.approvedFinalActionDigest !== digest) {
              const captured = await captureCurrentState();
              await this.audit.event("browser.approval_required", {
                taskId: input.taskId,
                digest,
                evidenceId: captured.id,
              });
              return { status: "TAKEOVER_REQUIRED", evidence, artifactIds, completedSteps };
            }
          }
          await this.engine.click(step.selector);
        } else if (step.action === "upload") {
          if (this.lifecycle.resolveArtifact === undefined) {
            throw new Error("Artifact upload resolution is unavailable.");
          }
          await this.engine.upload(
            step.selector,
            await this.lifecycle.resolveArtifact(step.artifactId),
          );
        } else if (step.action === "wait") {
          await this.engine.wait(step.selector, step.timeoutMs);
        }

        const pageText = await this.engine.contentText();
        const injection = detectPromptInjection(pageText);
        if (injection.blocked) {
          await this.audit.event("security.prompt_injection_blocked", {
            taskId: input.taskId,
            indicators: injection.indicators,
            pageContentClassification: "untrusted",
          });
        }
        const captured = await captureCurrentState();
        completedSteps += 1;
        if (
          /\b(?:one[- ]time (?:code|password)|verification code|authenticator|two[- ]factor|mfa)\b/i.test(
            pageText,
          )
        ) {
          await this.audit.event("browser.mfa_required", {
            taskId: input.taskId,
            evidenceId: captured.id,
          });
          return { status: "MFA_REQUIRED", evidence, artifactIds, completedSteps };
        }
        if (mode === "takeover") {
          await this.audit.event("browser.takeover_requested", {
            taskId: input.taskId,
            evidenceId: captured.id,
          });
          return { status: "TAKEOVER_REQUIRED", evidence, artifactIds, completedSteps };
        }
        if (mode === "observed") {
          await this.audit.event("browser.observed", {
            taskId: input.taskId,
            completedSteps,
            evidenceId: captured.id,
          });
        }
      }
      return { status: "SUCCEEDED", evidence, artifactIds, completedSteps };
    } finally {
      if (this.engine.storageState !== undefined && this.lifecycle.persistSession !== undefined) {
        await this.lifecycle.persistSession(await this.engine.storageState());
      }
      await this.engine.close();
    }
  }
}

export class PlaywrightEngine implements BrowserEngine {
  readonly #downloads: Promise<{ fileName: string; bytes: Uint8Array; mimeType: string }>[] = [];
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  public static async launch(options: {
    executablePath?: string;
    allowlist: string[];
    storageState?: string;
    requireTls?: boolean;
  }): Promise<PlaywrightEngine> {
    const browser = await chromium.launch({
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-first-run"],
    });
    const context = await browser.newContext({
      ...(options.storageState === undefined
        ? {}
        : {
            storageState: JSON.parse(options.storageState) as Exclude<
              BrowserContextOptions["storageState"],
              undefined
            >,
          }),
      acceptDownloads: true,
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      try {
        await assertSafeBrowserUrl(
          route.request().url(),
          options.allowlist,
          undefined,
          options.requireTls,
        );
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    const engine = new PlaywrightEngine(browser, context, page);
    page.on("download", (download) => {
      engine.#downloads.push(
        (async () => {
          const stream = await download.createReadStream();
          if (stream === null) throw new Error("Browser download stream is unavailable.");
          const chunks: Buffer[] = [];
          for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
            chunks.push(Buffer.from(chunk));
          }
          return {
            fileName: download.suggestedFilename(),
            bytes: Uint8Array.from(Buffer.concat(chunks)),
            mimeType: "application/octet-stream",
          };
        })(),
      );
    });
    return engine;
  }

  public async navigate(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }
  public async click(selector: string) {
    await this.page.locator(selector).click();
  }
  public async fill(selector: string, value: string) {
    await this.page.locator(selector).fill(value);
  }
  public async upload(selector: string, path: string) {
    await this.page.locator(selector).setInputFiles(path);
  }
  public async wait(selector: string, timeoutMs: number) {
    await this.page.locator(selector).waitFor({ timeout: timeoutMs });
  }
  public async screenshot() {
    return this.page.screenshot({ fullPage: true });
  }
  public async accessibilityText() {
    return this.page.locator("body").ariaSnapshot({ timeout: 10_000 });
  }
  public async contentText() {
    return (await this.page.locator("body").innerText()).slice(0, 100_000);
  }
  public async currentUrl() {
    return this.page.url();
  }
  public async storageState() {
    return JSON.stringify(await this.context.storageState());
  }
  public async drainDownloads() {
    const downloads = await Promise.all(this.#downloads.splice(0));
    return downloads;
  }
  public async close() {
    await this.context.close();
    await this.browser.close();
  }
}

export * from "./security.js";
export * from "./client.js";
