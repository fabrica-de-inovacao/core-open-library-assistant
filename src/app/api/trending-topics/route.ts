import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getModelForTask } from '@/lib/ai-provider';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';
import { eq, desc, count, sql } from 'drizzle-orm';

/* Fase 8 (P-trending): Tópicos em alta — duas fontes mescladas:
 *   1. OpenAlex /topics  →  top Computer Science por works_count
 *   2. Nossa DB          →  originalQuery recentes com status='done'
 *
 * Uma única chamada ao Gemini:
 *   - traduz tópicos do OpenAlex para pt-BR
 *   - extrai temas recorrentes das nossas queries
 *   - funde e deduplica tudo em até 12 tópicos finais
 *
 * Cache Next.js revalidate: 3600 (1h) — a chamada LLM só acontece 1×/hora.
 */

export interface TrendingTopic {
  id: string;
  label: string;
  field: string;
  source: 'openalex' | 'sol' | 'mixed';
  worksCount: number;
}

interface OpenAlexTopic {
  id: string;
  display_name: string;
  works_count: number;
  field?: { display_name: string };
  subfield?: { display_name: string };
}

interface OpenAlexResponse {
  results: OpenAlexTopic[];
}

// Fallback (Computação, pt-BR) — usado se qualquer etapa falhar
const FALLBACK_TOPICS: TrendingTopic[] = [
  {
    id: 'fb-1',
    label: 'Grandes Modelos de Linguagem (LLMs)',
    field: 'IA & ML',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-2',
    label: 'Aprendizado de Máquina Aplicado',
    field: 'Machine Learning',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-3',
    label: 'Computação em Nuvem e Edge Computing',
    field: 'Sistemas Distribuídos',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-4',
    label: 'Segurança e Privacidade em Redes',
    field: 'Cibersegurança',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-5',
    label: 'Interfaces Humano-Computador (HCI)',
    field: 'HCI',
    source: 'mixed',
    worksCount: 0,
  },
  { id: 'fb-6', label: 'Computação Quântica', field: 'Computação', source: 'mixed', worksCount: 0 },
  {
    id: 'fb-7',
    label: 'Visão Computacional e Processamento de Imagem',
    field: 'IA & ML',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-8',
    label: 'Processamento de Linguagem Natural (NLP)',
    field: 'IA & ML',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-9',
    label: 'Internet das Coisas (IoT)',
    field: 'Sistemas Embarcados',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-10',
    label: 'Blockchain e Sistemas Descentralizados',
    field: 'Computação',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-11',
    label: 'DevOps e Engenharia de Software Ágil',
    field: 'Engenharia de Software',
    source: 'mixed',
    worksCount: 0,
  },
  {
    id: 'fb-12',
    label: 'Redes Neurais e Deep Learning',
    field: 'IA & ML',
    source: 'mixed',
    worksCount: 0,
  },
];

export async function GET() {
  try {
    // ── 1. Busca em paralelo: OpenAlex + nossas queries recentes ──────────
    const [openAlexRes, recentQueriesRaw] = await Promise.allSettled([
      fetch(
        'https://api.openalex.org/topics' +
          '?sort=works_count:desc' +
          '&per-page=10' +
          '&filter=field.id:17' + // field 17 = Computer Science
          '&mailto=contact@sol-ola.com',
        {
          next: { revalidate: 3600 },
          headers: { 'User-Agent': 'SOL-OLA/1.0 (mailto:contact@sol-ola.com)' },
        }
      ),
      // Queries mais recorrentes com status=done — covering index scan em (status, original_query).
      // GROUP BY + COUNT no banco: o Postgres faz todo o trabalho pesado;
      // chegam ao máximo 12 strings distintas para o LLM, não 40 brutas.
      db
        .select({
          originalQuery: searchQueries.originalQuery,
          frequency: count().as('frequency'),
        })
        .from(searchQueries)
        .where(eq(searchQueries.status, 'done'))
        .groupBy(searchQueries.originalQuery)
        .orderBy(desc(sql`count(*)`))
        .limit(12),
    ]);

    // ── 2. Processa resultados do OpenAlex ────────────────────────────────
    let openAlexTopics: Array<{ label: string; field: string; worksCount: number }> = [];
    if (openAlexRes.status === 'fulfilled' && openAlexRes.value.ok) {
      const data = (await openAlexRes.value.json()) as OpenAlexResponse;
      openAlexTopics = (data.results ?? []).slice(0, 10).map((t) => ({
        label: t.display_name,
        field: t.subfield?.display_name ?? t.field?.display_name ?? 'Computer Science',
        worksCount: t.works_count,
      }));
    }

    // ── 3. Processa queries da SOL ────────────────────────────────────────
    // Já chegam pré-agrupadas e ordenadas por recorrência (GROUP BY no banco)
    const solQueries: Array<{ query: string; frequency: number }> =
      recentQueriesRaw.status === 'fulfilled'
        ? recentQueriesRaw.value
            .filter((r) => r.originalQuery?.trim())
            .map((r) => ({
              query: r.originalQuery!.trim(),
              frequency: Number(r.frequency ?? 1),
            }))
        : [];

    // Se não há nenhuma fonte, cai no fallback
    if (openAlexTopics.length === 0 && solQueries.length === 0) {
      throw new Error('Nenhuma fonte disponível');
    }

    // ── 4. Gemini: traduz + extrai + funde em pt-BR ───────────────────────
    const { object } = await generateObject({
      model: getModelForTask('tldr'),
      schema: z.object({
        topics: z.array(
          z.object({
            id: z.string().describe('identificador único curto, ex: t-1, t-2'),
            label: z.string().describe('nome do tópico em pt-BR, conciso (máx 6 palavras)'),
            field: z.string().describe('subárea em pt-BR, concisa (máx 3 palavras)'),
            source: z.enum(['openalex', 'sol', 'mixed']),
          })
        ),
      }),
      prompt: [
        'Você é um curador de tópicos acadêmicos em Ciência da Computação.',
        'Receba duas listas e produza até 12 tópicos distintos em Português do Brasil (pt-BR).',
        'Regras:',
        '- Priorize temas com maior frequency nas queries da SOL.',
        '- Complemente com tópicos do OpenAlex que não estejam cobertos.',
        '- Deduplicar semanticamente (Ex: "Machine Learning" e "Aprendizado de Máquina" → apenas 1).',
        '- Labels: Português do Brasil, terminologia acadêmica, máx 6 palavras, manter siglas consagradas (LLM, NLP, IoT, HCI).',
        '- source: "sol" se veio das queries da plataforma, "openalex" se veio do OpenAlex, "mixed" se representa ambos.',
        '- Retorne exatamente entre 10 e 12 itens.',
        '',
        '## Tópicos OpenAlex (inglês):',
        JSON.stringify(openAlexTopics),
        '',
        '## Queries recorrentes dos usuários da SOL (query + nº de ocorrências):',
        solQueries.length > 0 ? JSON.stringify(solQueries) : '(nenhuma ainda)',
      ].join('\n'),
    });

    const topics: TrendingTopic[] = object.topics.map((t, i) => ({
      id: t.id || `t-${i + 1}`,
      label: t.label,
      field: t.field,
      source: t.source,
      worksCount: 0,
    }));

    return NextResponse.json({ topics });
  } catch (err) {
    console.warn('[trending-topics] Usando fallback:', (err as Error).message);
    return NextResponse.json({ topics: FALLBACK_TOPICS });
  }
}
