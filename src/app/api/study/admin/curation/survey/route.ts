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
  getSurveyConfig,
  resetSurveyItems,
  saveSurveyItems,
  surveyRespondentCount,
} from '@/lib/study/survey-store';
import { SURVEY_SCALE_CHOICES, SURVEY_SCALE_MIN } from '@/lib/study/survey-items';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const [config, answered, respondents] = await Promise.all([
    getSurveyConfig(),
    answeredItemKeys(),
    surveyRespondentCount(),
  ]);
  return NextResponse.json({
    items: config.items,
    answeredKeys: answered,
    respondents,
    scale: { min: SURVEY_SCALE_MIN, max: config.scaleMax, choices: SURVEY_SCALE_CHOICES },
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let body: { items?: unknown; reset?: boolean; scaleMax?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    if (body.reset) {
      const result = await resetSurveyItems(gate.actor.code);
      return NextResponse.json({ success: true, ...result });
    }
    const result = await saveSurveyItems(body.items, gate.actor.code, body.scaleMax);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === 'scale_locked') {
      return NextResponse.json(
        {
          error: 'scale_locked',
          message:
            'Answers already exist on the current scale — a 5 there is not a 5 on a different one. Wording can still be edited.',
        },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === 'invalid_scale') {
      return NextResponse.json({ error: 'invalid_scale' }, { status: 400 });
    }
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
