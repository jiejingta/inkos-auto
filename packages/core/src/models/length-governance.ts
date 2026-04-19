import { z } from "zod";

export const DEFAULT_SOFT_RANGE_RATIO = 300 / 2200;
export const DEFAULT_HARD_RANGE_RATIO = 600 / 2200;

export const LengthCountingModeSchema = z.enum(["zh_chars", "en_words"]);
export type LengthCountingMode = z.infer<typeof LengthCountingModeSchema>;

export const LengthNormalizeModeSchema = z.enum(["expand", "compress", "none"]);
export type LengthNormalizeMode = z.infer<typeof LengthNormalizeModeSchema>;

export const LengthRangeConfigSchema = z.object({
  softRatio: z.number().gt(0).lte(1).default(DEFAULT_SOFT_RANGE_RATIO),
  hardRatio: z.number().gt(0).lte(1).default(DEFAULT_HARD_RANGE_RATIO),
}).refine(
  (value) => value.hardRatio >= value.softRatio,
  {
    message: "hardRatio must be greater than or equal to softRatio",
    path: ["hardRatio"],
  },
);

export type LengthRangeConfig = z.infer<typeof LengthRangeConfigSchema>;

export const LengthGovernanceConfigSchema = z.object({
  range: LengthRangeConfigSchema.default({
    softRatio: DEFAULT_SOFT_RANGE_RATIO,
    hardRatio: DEFAULT_HARD_RANGE_RATIO,
  }),
});

export type LengthGovernanceConfig = z.infer<typeof LengthGovernanceConfigSchema>;

export const LengthSpecSchema = z.object({
  target: z.number().int().min(1),
  softMin: z.number().int().min(1),
  softMax: z.number().int().min(1),
  hardMin: z.number().int().min(1),
  hardMax: z.number().int().min(1),
  countingMode: LengthCountingModeSchema,
  normalizeMode: LengthNormalizeModeSchema,
});

export type LengthSpec = z.infer<typeof LengthSpecSchema>;

export const LengthTelemetrySchema = z.object({
  target: z.number().int().min(1),
  softMin: z.number().int().min(1),
  softMax: z.number().int().min(1),
  hardMin: z.number().int().min(1),
  hardMax: z.number().int().min(1),
  countingMode: LengthCountingModeSchema,
  writerCount: z.number().int().min(0),
  postWriterNormalizeCount: z.number().int().min(0),
  postReviseCount: z.number().int().min(0),
  finalCount: z.number().int().min(0),
  normalizeApplied: z.boolean(),
  lengthWarning: z.boolean(),
});

export type LengthTelemetry = z.infer<typeof LengthTelemetrySchema>;

export const LengthWarningSchema = z.object({
  chapter: z.number().int().min(1),
  target: z.number().int().min(1),
  actual: z.number().int().min(0),
  countingMode: LengthCountingModeSchema,
  reason: z.string().min(1),
});

export type LengthWarning = z.infer<typeof LengthWarningSchema>;
