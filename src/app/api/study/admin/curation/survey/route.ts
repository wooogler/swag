/**
 * The questionnaire, as an editable setting.
 *
 * Answers are never rewritten here. If an item disappears from the instrument
 * its recorded answers stay put, and the response says so — deleting a
 * participant's answer to make an edit tidy would be the wrong trade.
 */
import { NextResponse } from 'next/server';
import {
  answeredItemKeys,
  getSurveyItems,
  resetSurveyItems,
  saveSurveyItems,
  surveyRespondentCount,
} from '@/lib/study/survey-store';
import { SURVEY_SCALE_MAX, SURVEY_SCALE_MIN } from '@/lib/study/survey-items';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const [items, answered, respondents] = await Promise.all([
    getSurveyItems(),
    answeredItemKeys(),
    surveyRespondentCount(),
  ]);
  return NextResponse.json({
    items,
    answeredKeys: answered,
    respondents,
    scale: { min: SURVEY_SCALE_MIN, max: SURVEY_SCALE_MAX },
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let body: { items?: unknown; reset?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    if (body.reset) {
      const items = await resetSurveyItems(gate.actor.code);
      return NextResponse.json({ success: true, items, orphanedKeys: [] });
    }
    const result = await saveSurveyItems(body.items, gate.actor.code);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === 'invalid_items') {
      return NextResponse.json(
        {
          error: 'invalid_items',
          message:
            'Every item needs a unique lower_snake key, a construct, question text and both anchors.',
        },
        { status: 400 }
      );
    }
    console.error('survey config error:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
