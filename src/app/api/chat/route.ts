import OpenAI, { APIConnectionError, AuthenticationError, RateLimitError } from 'openai';
import { db } from '@/db/db';
import { assignments, chatMessages } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { resolveDeployedChatPrompt } from '@/lib/score/deploy-store';
import { getCloneCondition, resolveBaselineChatPrompt } from '@/lib/study/baseline-store';
import { familyOf } from '@/lib/study/config';
import { resolveSimpleLive } from '@/lib/study/simple/live';
import { getSimpleSaved } from '@/lib/study/simple/store';
import { eq } from 'drizzle-orm';

interface ChatErrorDetails {
  status: number;
  code: string;
  message: string;
}

const DEFAULT_CHAT_ERROR_MESSAGE =
  'The AI assistant ran into a problem and could not complete that reply. Please try again.';

const EMPTY_ASSISTANT_RESPONSE_MESSAGE =
  'The AI assistant returned an empty response. Please try again.';

const jsonError = (details: ChatErrorDetails) =>
  Response.json(
    {
      error: {
        code: details.code,
        message: details.message,
      },
    },
    { status: details.status }
  );

const resolveChatError = (error: unknown): ChatErrorDetails => {
  if (error instanceof AuthenticationError) {
    return {
      status: 502,
      code: 'OPENAI_AUTHENTICATION_FAILED',
      message:
        'The AI assistant is unavailable because the server OpenAI credentials were rejected. Please ask an administrator to verify OPENAI_API_KEY.',
    };
  }

  if (error instanceof RateLimitError) {
    return {
      status: 429,
      code: 'OPENAI_RATE_LIMITED',
      message:
        'The AI assistant is temporarily rate limited. Please wait a moment and try again.',
    };
  }

  if (error instanceof APIConnectionError) {
    return {
      status: 503,
      code: 'OPENAI_CONNECTION_FAILED',
      message:
        'The AI assistant could not reach OpenAI right now. Please try again in a moment.',
    };
  }

  return {
    status: 500,
    code: 'CHAT_REQUEST_FAILED',
    message: DEFAULT_CHAT_ERROR_MESSAGE,
  };
};

const createOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
};

const persistAssistantMessage = async ({
  conversationId,
  content,
  metadata,
}: {
  conversationId: string;
  content: string;
  metadata: Record<string, unknown>;
}) => {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return;
  }

  try {
    const existingMessages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.conversationId, conversationId),
    });

    await db.insert(chatMessages).values({
      conversationId,
      role: 'assistant',
      content: trimmedContent,
      metadata,
      timestamp: new Date(),
      sequenceNumber: existingMessages.length,
    });
  } catch (error) {
    console.error('Failed to persist assistant message:', error);
  }
};

export async function POST(req: Request) {
  try {
    const { messages, conversationId, sessionId, assignmentId, webSearchEnabled } = await req.json();

    console.log('Chat API received:', { conversationId, sessionId, assignmentId, messagesCount: messages?.length, webSearchEnabled });

    // Validate conversationId
    if (!conversationId) {
      console.error('Missing conversationId');
      return jsonError({
        status: 400,
        code: 'MISSING_CONVERSATION_ID',
        message: 'Conversation ID is required.',
      });
    }

    // Fetch assignment to get AI guidance configuration
    const assignment = await db.query.assignments.findFirst({
      where: eq(assignments.id, assignmentId),
    });

    if (!assignment) {
      return jsonError({
        status: 404,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'The chat assignment configuration could not be found.',
      });
    }

    // Shared with SCORE's rule previews (preview = runtime) — see
    // assignmentBasePrompt in assignment-ai.ts before changing.
    const basePrompt = assignmentBasePrompt(assignment);

    // Save user message immediately
    const lastMessage = messages[messages.length - 1];
    const userMessageContent = lastMessage.content;
    const userMessageTimestamp = new Date();
    const existingMessages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.conversationId, conversationId),
    });

    // SCORE rule injection (P5): under the assignment's LATEST DEPLOY, classify
    // this message against the deployed intents and answer with the owning
    // intent's rule AS the system prompt (one layer, never two — injection.ts).
    // Instructors editing the SCORE board never affect students until they
    // Deploy. Fail-open: no deploy / no match / any error → the assignment's
    // default prompt (deploy-store.resolveDeployedChatPrompt).
    // Prior exchange for the classifier comes from the SERVER's own record
    // (not the client-supplied messages array, which a student could fabricate
    // to steer the classifier): the last stored assistant reply and the user
    // message that preceded it.
    const ordered = [...existingMessages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const prevAssistantIdx = ordered.map((m) => m.role).lastIndexOf('assistant');
    const prevResponseText = prevAssistantIdx >= 0 ? ordered[prevAssistantIdx].content : null;
    const prevUser = ordered
      .slice(0, prevAssistantIdx >= 0 ? prevAssistantIdx : ordered.length)
      .filter((m) => m.role === 'user')
      .pop();
    // Study BASELINE clones bypass intent classification/injection entirely and
    // serve the instructor's deployed monolithic prompt (fail-open to base).
    // SCORE clones + all non-study assignments take the intent-routing path.
    const condition = await getCloneCondition(assignmentId);
    let deployed: Awaited<ReturnType<typeof resolveDeployedChatPrompt>>;
    if (condition && familyOf(condition) === 'simple') {
      // The simple version's newest saved version is what a question is
      // answered against; there is no deploy pointer to look up and, on the
      // intent arm, no query-type call in front of the routing.
      // The saved one: an apply is the instructor still deciding, and a
      // student should not be answered by a configuration nobody committed to.
      const tip = await getSimpleSaved({
        assignmentId,
        condition,
        seedPrompt: basePrompt,
      });
      try {
        const route = await resolveSimpleLive({
          snapshot: tip.snapshot,
          queryText: userMessageContent,
          prevQueryText: prevUser?.content ?? null,
          prevResponseText,
          // A student is waiting: fail fast, and fall open below.
          callOptions: { timeoutMs: 15_000, maxRetries: 0 },
        });
        deployed = {
          systemPrompt: route.systemPrompt,
          applied:
            route.sid == null
              ? null
              : {
                  intentId: route.sid,
                  intentTitle: route.title ?? '',
                  rule: route.systemPrompt,
                  outcome: 'intent' as const,
                  // No query types in this version — the field stays, empty,
                  // so the reply metadata keeps one shape across both.
                  type: null,
                },
          deployVersion: tip.version?.versionNo ?? null,
        };
      } catch {
        // Same posture as the full version: a classifier that cannot answer
        // must not stop the student's reply.
        deployed = { systemPrompt: basePrompt, applied: null, deployVersion: null };
      }
    } else if (condition === 'baseline') {
      const baselinePrompt = await resolveBaselineChatPrompt(assignmentId, basePrompt);
      deployed = { systemPrompt: baselinePrompt, applied: null, deployVersion: null };
    } else {
      deployed = await resolveDeployedChatPrompt({
        assignmentId,
        basePrompt,
        queryText: userMessageContent,
        prevQueryText: prevUser?.content ?? null,
        prevResponseText,
      });
    }
    const systemPrompt = deployed.systemPrompt;

    await db.insert(chatMessages).values({
      conversationId,
      role: 'user',
      content: userMessageContent,
      metadata: { webSearchEnabled: webSearchEnabled || false },
      timestamp: userMessageTimestamp,
      sequenceNumber: existingMessages.length,
    });

    // Format messages for OpenAI Responses API (requires 'msg' prefix for IDs)
    const formattedMessages = messages.map((msg: { id?: string; role: string; content: string }, idx: number) => ({
      id: msg.id?.startsWith('msg') ? msg.id : `msg_${Date.now()}_${idx}`,
      role: msg.role,
      content: msg.content,
    }));

    const openai = createOpenAIClient();
    if (!openai) {
      const details: ChatErrorDetails = {
        status: 503,
        code: 'OPENAI_NOT_CONFIGURED',
        message:
          'The AI assistant is unavailable because OPENAI_API_KEY is not configured on the server.',
      };

      await persistAssistantMessage({
        conversationId,
        content: details.message,
        metadata: {
          isError: true,
          errorCode: details.code,
          webSearchEnabled: webSearchEnabled || false,
        },
      });

      return jsonError(details);
    }

    // Create streaming response using OpenAI Responses API
    let stream;
    try {
      stream = await openai.responses.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        // An empty base prompt (e.g. NIRVANA, which ran with no system prompt)
        // and no injected rule → send no system message at all, rather than an
        // empty one. SCORE's rule previews (preview-service) do the same so
        // preview = runtime holds at the "no guidance" baseline.
        input: [
          ...(systemPrompt.trim()
            ? [{ id: 'msg_system', role: 'system' as const, content: systemPrompt }]
            : []),
          ...formattedMessages,
        ],
        tools: webSearchEnabled ? [{ type: 'web_search' }] : undefined,
        stream: true,
      });
    } catch (error) {
      const details = resolveChatError(error);

      await persistAssistantMessage({
        conversationId,
        content: details.message,
        metadata: {
          isError: true,
          errorCode: details.code,
          webSearchEnabled: webSearchEnabled || false,
        },
      });

      return jsonError(details);
    }

    // Convert OpenAI stream to Response stream
    const encoder = new TextEncoder();
    let fullResponse = '';
    let webSearchUsed = false;

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            // Detect web search usage
            if (event.type === 'response.output_item.added') {
              const item = (event as unknown as { item: { type: string } }).item;
              if (item?.type === 'web_search_call') {
                webSearchUsed = true;
              }
            }

            // Handle different event types from Responses API
            if (event.type === 'response.output_text.delta') {
              const delta = event.delta || '';
              if (delta) {
                fullResponse += delta;
                controller.enqueue(encoder.encode(delta));
              }
            }
          }

          const finalContent = fullResponse.trim() || EMPTY_ASSISTANT_RESPONSE_MESSAGE;

          if (!fullResponse.trim()) {
            controller.enqueue(encoder.encode(finalContent));
          }

          await persistAssistantMessage({
            conversationId,
            content: finalContent,
            metadata: {
              model: process.env.OPENAI_MODEL ?? 'gpt-4o',
              webSearchEnabled: webSearchEnabled || false,
              webSearchUsed,
              // SCORE deploy audit trail: which chat version answered, and
              // which intent's rule (if any) was injected for this reply.
              ...(deployed.deployVersion !== null ? { chatDeployVersion: deployed.deployVersion } : {}),
              ...(deployed.applied
                ? {
                    appliedIntentId: deployed.applied.intentId,
                    appliedIntentTitle: deployed.applied.intentTitle,
                    // v7: 'intent' = a set matched; 'type_default' = the chain
                    // ran out and the query type's own rule answered. Absent on
                    // pre-v7 replies, which is how they stay distinguishable.
                    appliedOutcome: deployed.applied.outcome,
                    ...(deployed.applied.type ? { appliedType: deployed.applied.type } : {}),
                  }
                : {}),
              ...(fullResponse.trim()
                ? {}
                : {
                    isError: true,
                    errorCode: 'EMPTY_RESPONSE',
                  }),
            },
          });

          controller.close();
        } catch (error) {
          const details = resolveChatError(error);
          console.error('Streaming error:', error);

          const recoveryText = fullResponse.trim()
            ? `\n\n${details.message}`
            : details.message;

          controller.enqueue(encoder.encode(recoveryText));

          await persistAssistantMessage({
            conversationId,
            content: `${fullResponse}${recoveryText}`,
            metadata: {
              model: process.env.OPENAI_MODEL ?? 'gpt-4o',
              webSearchEnabled: webSearchEnabled || false,
              webSearchUsed,
              isError: true,
              errorCode: details.code,
            },
          });

          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return jsonError(resolveChatError(error));
  }
}
