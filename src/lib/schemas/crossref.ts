/**
 * C-03: Schema Zod para a resposta da CrossRef API.
 * Validação em runtime evita crashes silenciosos quando a API muda o formato.
 *
 * Referência: https://api.crossref.org/swagger-ui/index.html
 */
import { z } from 'zod';

const DatePartsSchema = z.object({
  'date-parts': z.array(z.array(z.number())).optional(),
});

export const CrossRefWorkSchema = z.object({
  // Presente apenas no endpoint /works/{doi}
  DOI: z.string().optional(),
  // Presente apenas no endpoint /works?query=... (lista de resultados)
  score: z.number().optional(),
  title: z.array(z.string()).optional(),
  abstract: z.string().optional(),
  subject: z.array(z.string()).optional(),
  keyword: z.array(z.string()).optional(),
  'is-referenced-by-count': z.number().optional(),
  publisher: z.string().optional(),
  license: z.array(z.object({ URL: z.string() })).optional(),
  // Campos adicionais usados em add-by-doi
  author: z
    .array(z.object({ given: z.string().optional(), family: z.string().optional() }))
    .optional(),
  'published-print': DatePartsSchema.optional(),
  'published-online': DatePartsSchema.optional(),
  'container-title': z.array(z.string()).optional(),
});

export const CrossRefResponseSchema = z.object({
  status: z.string(),
  message: CrossRefWorkSchema.optional(),
});

/** Schema para o endpoint de busca: GET /works?query=... (retorna lista com score) */
export const CrossRefSearchResponseSchema = z.object({
  status: z.string(),
  message: z
    .object({
      items: z.array(CrossRefWorkSchema).optional(),
    })
    .optional(),
});

export type CrossRefWork = z.infer<typeof CrossRefWorkSchema>;
export type CrossRefResponse = z.infer<typeof CrossRefResponseSchema>;
export type CrossRefSearchResponse = z.infer<typeof CrossRefSearchResponseSchema>;
