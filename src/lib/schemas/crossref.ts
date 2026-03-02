/**
 * C-03: Schema Zod para a resposta da CrossRef API.
 * Validação em runtime evita crashes silenciosos quando a API muda o formato.
 *
 * Referência: https://api.crossref.org/swagger-ui/index.html
 */
import { z } from 'zod';

export const CrossRefWorkSchema = z.object({
  title: z.array(z.string()).optional(),
  abstract: z.string().optional(),
  subject: z.array(z.string()).optional(),
  keyword: z.array(z.string()).optional(),
  'is-referenced-by-count': z.number().optional(),
  publisher: z.string().optional(),
  license: z.array(z.object({ URL: z.string() })).optional(),
});

export const CrossRefResponseSchema = z.object({
  status: z.string(),
  message: CrossRefWorkSchema.optional(),
});

export type CrossRefWork = z.infer<typeof CrossRefWorkSchema>;
export type CrossRefResponse = z.infer<typeof CrossRefResponseSchema>;
