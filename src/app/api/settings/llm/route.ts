import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { userLlmSettings } from '@/server/db/schema';
import { encryptSecret } from '@/server/llm/crypto';
import { isLlmProvider, PROVIDERS } from '@/lib/llm/registry';

const settingsSchema = z.object({
  provider: z.string().refine(isLlmProvider),
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
    settings: settings
      ? {
          provider: settings.provider,
          models: settings.models,
          useOwnKey: settings.useOwnKey,
          hasApiKey: Boolean(settings.encryptedApiKey),
          apiKeyLast4: settings.apiKeyLast4,
        }
      : null,
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const input = settingsSchema.parse(await request.json());
  const encryptedApiKey = input.apiKey ? encryptSecret(input.apiKey) : undefined;
  const apiKeyLast4 = input.apiKey ? input.apiKey.slice(-4) : undefined;

  await db
    .insert(userLlmSettings)
    .values({
      userId: session.user.id,
      provider: input.provider,
      models: input.models,
      useOwnKey: input.useOwnKey,
      ...(encryptedApiKey && { encryptedApiKey, apiKeyLast4 }),
    })
    .onConflictDoUpdate({
      target: userLlmSettings.userId,
      set: {
        provider: input.provider,
        models: input.models,
        useOwnKey: input.useOwnKey,
        updatedAt: new Date(),
        ...(encryptedApiKey && { encryptedApiKey, apiKeyLast4 }),
      },
    });

  return NextResponse.json({ ok: true });
}
