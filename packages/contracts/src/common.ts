import { z } from "zod";

export const utcTimestampSchema = z.iso.datetime({ offset: true });
export const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const opaqueCursorSchema = z.string().min(8).max(2048);
export const idempotencyKeySchema = z.string().min(8).max(200);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
export const currencySchema = z
  .string()
  .length(3)
  .transform((value) => value.toUpperCase());
export const moneySchema = z
  .object({
    amountMinor: z.int().nonnegative(),
    currency: currencySchema,
  })
  .strict();

export const paginationQuerySchema = z
  .object({
    cursor: opaqueCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: opaqueCursorSchema.nullable(),
    })
    .strict();

export const dataClassificationSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "highly_sensitive",
  "secret",
]);

export const publicJsonValueSchema: z.ZodType<unknown> = z.json();
