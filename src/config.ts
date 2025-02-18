import { z } from 'zod';
import * as core from '@actions/core';
import * as fs from 'node:fs';
import { generateErrorMessage } from 'zod-error';
import ms, { StringValue } from 'ms';

export const TagName = z
  .object({
    name: z.string(),
  })
  .strict();

export type ValueOrExpression = z.infer<typeof ValueOrExpression>;
export const ValueOrExpression = z.union([
  z.string(),
  z.object({
    expression: z.string(),
  }),
]);

export const TagNameMapped = z
  .object({
    name: z.string(),
    mapped: z.string(),
    extraBuildArgs: z.record(z.string(), ValueOrExpression).optional(),
    extraLabels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    buildTarget: z.string().optional(),
  })
  .strict();

export const TagNameExpression = z
  .object({
    name: z.string(),
    expression: z.string(),
    extraBuildArgs: z.record(z.string(), ValueOrExpression).optional(),
    extraLabels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    buildTarget: z.string().optional(),
  })
  .strict();

export const TagPattern = z
  .object({
    pattern: z.string(),
    extraBuildArgs: z.record(z.string(), ValueOrExpression).optional(),
    extraLabels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    buildTarget: z.string().optional(),
  })
  .strict();

export const TagPatternMapped = z
  .object({
    pattern: z.string(),
    mapped: z.string(),
    extraBuildArgs: z.record(z.string(), ValueOrExpression).optional(),
    extraLabels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    buildTarget: z.string().optional(),
  })
  .strict();

export const TagPatternExpression = z
  .object({
    pattern: z.string(),
    expression: z.string(),
    extraBuildArgs: z.record(z.string(), ValueOrExpression).optional(),
    extraLabels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    buildTarget: z.string().optional(),
  })
  .strict();

export type TagFilter = z.infer<typeof TagFilter>;
export const TagFilter = z.union([
  TagName,
  TagNameMapped,
  TagNameExpression,
  TagPattern,
  TagPatternMapped,
  TagPatternExpression,
  z.string(),
]);

export const Filters = z
  .object({
    oldest_tag_limit: z.string().optional(),
    limit_releases: z.number().gt(0).int().optional(),
    page_limit: z.number().gt(0).int().optional(),
    tags: z.array(TagFilter).optional(),
  })
  .strict();

export const Variant = z
  .object({
    namespace: z.string().optional().default('library'),
    name: z.string(),
    platforms: z
      .array(z.string())
      .nonempty()
      .refine((items) => new Set(items).size === items.length, {
        message: 'All items must be unique, no duplicate values allowed',
      }),
    upstream: z
      .object({
        namespace: z.string().optional().default('library'),
        name: z.string(),
      })
      .strict(),
    filters: Filters.optional(),
    buildArgs: z.record(z.string(), ValueOrExpression).optional(),
    labels: z.record(z.string(), ValueOrExpression).optional(),
    extraTags: z.array(ValueOrExpression).optional(),
    include: z
      .array(z.string())
      .refine((items) => new Set(items).size === items.length, {
        message: 'All items must be unique, no duplicate values allowed',
      }).default([]),
    buildTarget: z.string().optional(),
  })
  .strict();

export type WrapperImageConfig = z.infer<typeof WrapperImageConfig>;
export const WrapperImageConfig = z
  .object({
    variants: z.array(Variant).nonempty(),
    ['$schema']: z.string().optional(),
  })
  .strict();

export function parseConfig(file: string): WrapperImageConfig {
  if (!fs.existsSync(file)) {
    throw new Error(`Config file "${file}" does not exist`);
  }

  const json = fs.readFileSync(file, 'utf-8');
  const parsed = JSON.parse(json);
  const result = WrapperImageConfig.safeParse(parsed);

  if (result.success) {
    core.info(`Parsed config file "${file}"`);

    return result.data;
  }

  throw new Error(
    'Errors while parsing config file: ' +
      generateErrorMessage(result.error.issues, {
        prefix: '["',
        suffix: '"]',
        delimiter: {
          error: '", "',
          component: '',
        },
        path: {
          enabled: true,
          type: 'objectNotation',
          transform: ({ value }) => {
            if (!value) {
              return '';
            }

            return `Field (${value.replaceAll('"', '\\"')}) `;
          },
        },
        code: { enabled: false },
        message: {
          enabled: true,
          transform: ({ value }) =>
            `${value.replaceAll('"', '\\"').replaceAll('"', '\\"')}`,
        },
        transform: ({ errorMessage }) => `${errorMessage}`,
      }),
  );
}

export interface ImageTagFilters {
  oldest_tag_limit?: number;
  limit_releases?: number;
  pageLimit: number;
  platforms: Set<string>;
  tags: TagFilter[];
}
export interface ProcessedWrapperImageConfigVariant {
  namespace: string;
  name: string;
  imageName: string;
  platforms: string[];
  upstream: {
    namespace: string;
    name: string;
    imageName: string;
  };
  filters: ImageTagFilters;
  extraTags: ValueOrExpression[];
  buildArgs: Record<string, ValueOrExpression>;
  labels: Record<string, ValueOrExpression>;
  include: string[];
  buildTarget?: string;
}

export interface ProcessedWrapperImageConfig {
  variants: ProcessedWrapperImageConfigVariant[]
}

export function processConfig(
  input: WrapperImageConfig,
): ProcessedWrapperImageConfig {
  const result: ProcessedWrapperImageConfigVariant[] = [];

  for (const variant of input.variants) {
    const oldestTagLimit = variant.filters?.oldest_tag_limit;
    let oldestTagLimitParsed: number | undefined = undefined;
    if (oldestTagLimit != null) {
      try {
        oldestTagLimitParsed = ms(oldestTagLimit as StringValue);
      } catch (e) {
        throw new Error(
          `Failed to process "filters.oldest_tag_limit" value (${oldestTagLimit}): ${e}`,
        );
      }
    }

    result.push({
      namespace: variant.namespace,
      name: variant.name,
      platforms: variant.platforms,
      imageName: `${variant.namespace !== 'library' ? `${variant.namespace}/` : ''}${variant.name}`,
      upstream: {
        name: variant.upstream.name,
        namespace: variant.upstream.namespace,
        imageName: `${variant.upstream.namespace !== 'library' ? `${variant.upstream.namespace}/` : ''}${variant.upstream.name}`,
      },
      filters: {
        oldest_tag_limit:
          oldestTagLimitParsed != null ? oldestTagLimitParsed / 1000 : undefined,
        limit_releases: variant.filters?.limit_releases,
        pageLimit: variant.filters?.page_limit ?? 0,
        platforms: new Set(variant.platforms),
        tags: variant.filters?.tags ?? [],
      },
      extraTags: variant.extraTags ?? [],
      buildArgs: variant.buildArgs ?? {},
      labels: variant.labels ?? {},
      include: variant.include ?? [],
      buildTarget: variant.buildTarget ?? undefined,
    });
  }

  return {
    variants: result,
  };
}
