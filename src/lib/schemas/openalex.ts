/**
 * C-03: Schema Zod para a resposta da OpenAlex API.
 * Validação em runtime evita crashes silenciosos quando a API muda o formato.
 *
 * Referência: https://docs.openalex.org/api-entities/works
 */
import { z } from 'zod';

export const OpenAlexAuthorSchema = z.object({
  author: z.object({
    display_name: z.string(),
  }),
});

export const OpenAlexPrimaryLocationSchema = z.object({
  landing_page_url: z.string().nullable().optional(),
  source: z
    .object({
      display_name: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const OpenAlexWorkSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  authorships: z.array(OpenAlexAuthorSchema).default([]),
  publication_year: z.number().nullable().optional(),
  doi: z.string().nullable().optional(),
  primary_location: OpenAlexPrimaryLocationSchema.nullable().optional(),
  cited_by_count: z.number().nullable().optional(),
  keywords: z.array(z.object({ keyword: z.string().optional() }).passthrough()).optional(),
});

export const OpenAlexResponseSchema = z.object({
  results: z.array(OpenAlexWorkSchema).default([]),
  meta: z.object({
    count: z.number(),
  }),
});

export type OpenAlexWork = z.infer<typeof OpenAlexWorkSchema>;
export type OpenAlexResponse = z.infer<typeof OpenAlexResponseSchema>;
