import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { userLlmSettings, userProviderCredentials } from '@/server/db/schema';
import { encryptSecret } from '@/server/llm/crypto';
import { isLlmPreset, isLlmProvider, MODEL_CATALOG, presetModels, PROVIDERS, validateModels } from '@/lib/llm/registry';

const settingsSchema = z.object({
  provider: z.string().refine(isLlmProvider),
  preset: z.string().refine(isLlmPreset).default('balanced'),
  models: z.record(z.string(), z.string()).default({}),
  useOwnKey: z.boolean().default(false),
  apiKey: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [settings] = await db
    .select()
    .from(userLlmSettings)
    .where(eq(userLlmSettings.userId, session.user.id))
    .limit(1);

  return NextResponse.json({
    providers: PROVIDERS,
    catalog: MODEL_CATALOG,
    settings: settings
      ? {
          provider: settings.provider,
          preset: settings.preset,
          models: settings.models,
          useOwnKey: settings.useOwnKey,
          hasApiKey: false,
          apiKeyLast4: null,
        }
      : null,
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const input = settingsSchema.parse(await request.json());
  if (!validateModels(input.provider, input.models)) {
    return NextResponse.json({ error: 'Modelo incompatível com provider ou tarefa.' }, { status: 400 });
  }
  const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey) : undefined;
  const apiKeyLast4 = input.apiKey ? input.apiKey.slice(-4) : undefined;

  await db
    .insert(userLlmSettings)
    .values({
      userId: session.user.id,
      provider: input.provider,
      preset: input.preset,
      models: { ...presetModels(input.provider, input.preset), ...input.models },
      useOwnKey: input.useOwnKey,
      ...(encryptedApiKey && { encryptedApiKey, apiKeyLast4 }),
    })
    .onConflictDoUpdate({
      target: userLlmSettings.userId,
      set: {
        provider: input.provider,
        preset: input.preset,
        models: { ...presetModels(input.provider, input.preset), ...input.models },
        useOwnKey: input.useOwnKey,
        updatedAt: new Date(),
        ...(encryptedApiKey && { encryptedApiKey, apiKeyLast4 }),
      },
    });

  if (encryptedApiKey && apiKeyLast4) {
    await db
      .insert(userProviderCredentials)
      .values({ userId: session.user.id, provider: input.provider, encryptedApiKey, apiKeyLast4 })
      .onConflictDoUpdate({
        target: [userProviderCredentials.userId, userProviderCredentials.provider],
        set: { encryptedApiKey, apiKeyLast4, validationStatus: 'pending', updatedAt: new Date() },
      });
  }

  return NextResponse.json({ ok: true });
}
