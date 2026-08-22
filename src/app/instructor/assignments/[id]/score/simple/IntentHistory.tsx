'use client';

/**
 * One intent's own history, folded into the card it belongs to.
 *
 * The configuration has a timeline too, but it is the wrong place to ask "what
 * did this say before": by the time it matters you are looking at one intent,
 * and its three edits are scattered among everyone else's. So the version
 * number a participant reads belongs to the intent.
 *
 * It has been four shapes. A dropdown labelled "v2" — missed entirely, because
 * beside two neighbours that say what they hold ("Starter sets", "Reuse a
 * rule") a lone number reads as a status badge rather than something to open.
 * Then a whole list always open under the buttons — found, but it pushed the
 * boxes it is about off the screen. Then a heading that opened onto the list —
 * which fixed the height and hid the history behind a click nobody had a
 * reason to take, since a fold with no visible contents gives no reason to
 * open it.
 *
 * Now: the three newest are always on show, and the heading opens onto the
 * rest. Three is what "where am I" needs — the last save, the one before it,
 * and enough of a run to see a direction — and it costs about the height of
 * the button row above. Everything older is one click away, which is the right
 * price for a question people ask far less often.
 *
 * A version is the WHEN and the THEN together. They are one thought here, and
 * the same rule text can be right or wrong depending on what it was scoped to,
 * so restoring one without the other would hand back a half-sentence.
 *
 * Each row used to say which of the two moved — "when", "then", "when + then".
 * It was read as a time, or as nothing at all: the words name the fields on
 * the card above, and nobody carries that mapping around while scanning a
 * list. The count does the same job better, in the units the rest of the
 * board already counts in — a wording that catches more questions is a
 * wording that was widened, and it says so in a number that means the same
 * thing here as it does on the row in the tree.
 *
 * Every STORED row here is a save. Applying does not write one: applying is
 * meant to be cheap enough to do constantly, and a history of every wording
 * tried would be a list of keystrokes. The way back through applied states is
 * undo.
 *
 * What is applied and not saved gets a row anyway, at the top, carrying the
 * number the next save will give it: "v2 · unsaved" becomes "v2" when Save is
 * pressed, and the apply after that is v3. It is derived from the difference
 * between what is in effect and the newest save rather than stored, so it
 * cannot survive the save it describes. Without it the list said the newest
 * version was v1 while the board answered from something else entirely, and
 * the only place that disagreement showed was a grey word on the row above.
 *
 * Picking one puts both texts back in the boxes AND applies them, so the
 * question list beside it becomes that version's list without a second click.
 * It used to stop at the boxes, on the grounds that republishing silently
 * would be a fourth verb nobody asked for — but there is an undo now, and a
 * version you can read the text of but not the effect of is half a version.
 * That apply is also why applies must not be versioned: while they were,
 * reading your own history wrote new entries into it.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import QuestionCount, { questionsThat } from './QuestionCount';

export interface IntentVersion {
  id: number;
  sid: number;
  versionNo: number;
  definition: string;
  rule: string;
  title: string;
  name: string | null;
  summary: string | null;
  createdAt: string;
  configVersionNo: number | null;
  /** The number a reader sees: the SAVE this pair belongs to, counted the way
   * the timeline counts saves. One axis for the whole board — a private count
   * of an intent's own edits disagreed on screen with the picker beside it. */
  displayNo: number | null;
  /** How many of this log's questions that wording describes. Null for the
   * everything-else rule, which has no words to match with. */
  matches: number | null;
}

/**
 * How long ago, in the units a 25-minute block is lived in.
 *
 * A clock time asks the reader to subtract; "4m ago" is the answer they were
 * going to work out. Hours only appear if someone leaves a board open far
 * longer than a block.
 */
/** How much history a card carries without being asked. */
const SHOWN = 3;

/** A row of the list: a saved version, or the applied-and-unsaved one, which
 * has everything a row needs except a version to go back to. */
interface Row {
  key: string;
  versionNo: number;
  definition: string;
  rule: string;
  name: string | null;
  matches: number | null;
  createdAt: string | null;
  version: IntentVersion | null;
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default function IntentHistory({
  versions,
  currentDefinition,
  currentRule,
  nextVersionNo,
  pending = null,
  onPutBack = null,
  onPick,
  onRevert,
  disabled = false,
}: {
  versions: IntentVersion[];
  currentDefinition: string;
  currentRule: string;
  /** What the next save will be called — the timeline's number, not a private
   * count of this intent's own edits. */
  nextVersionNo: number;
  /**
   * The wording applied and not saved — not what is typed.
   *
   * It survives going off to look at an older row: work that has not been
   * saved is still work, and a list that drops it the moment you read
   * something else is a list you cannot read anything else from. When it is
   * not what is in effect, the row offers to put it back.
   */
  pending?: {
    definition: string;
    rule: string;
    name: string | null;
    /** What this wording catches now — the same number the saved rows show. */
    matches: number | null;
  } | null;
  /** Apply the pending wording again, after a look elsewhere. */
  onPutBack?: (() => void) | null;
  onPick: (version: IntentVersion) => void;
  /**
   * Go back to a saved version, dropping everything after it — across the
   * whole setup, because a version IS the whole setup.
   *
   * `configVersionNo` is null for the newest save, which needs nothing hidden:
   * only the working row is in the way, and a row that was never a version has
   * no history to keep.
   *
   * Beside the history because that is where the thing it goes back TO is
   * listed. Null when there is no save to go back to.
   */
  onRevert?: ((configVersionNo: number | null) => void) | null;
  disabled?: boolean;
}) {
  /** Expanded past the three newest onto the whole history. */
  const [all, setAll] = useState(false);
  // Relative times go stale on a card left open. One tick a minute is enough
  // for a readout whose smallest unit is a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (versions.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [versions.length]);
  /**
   * The rows, pending one first.
   *
   * It takes one of the three places rather than adding a fourth, so the card
   * keeps its height whether or not something is applied.
   */
  const rows: Row[] = [
    ...(pending
      ? [
          {
            key: 'pending',
            versionNo: nextVersionNo,
            definition: pending.definition,
            rule: pending.rule,
            matches: pending.matches,
            // The name the model wrote for the apply. Applies are named for
            // the reply's version picker anyway, and a row you are deciding
            // whether to keep is exactly where a one-line "what this did" is
            // worth reading.
            name: pending.name,
            createdAt: null,
            version: null,
          },
        ]
      : []),
    ...versions.map((v) => ({
      key: String(v.id),
      versionNo: v.displayNo ?? v.versionNo,
      definition: v.definition,
      rule: v.rule,
      name: v.name,
      matches: v.matches,
      createdAt: v.createdAt,
      version: v,
    })),
  ];
  const more = rows.length > SHOWN;
  const shown = all ? rows : rows.slice(0, SHOWN);

  /**
   * Where Revert lands, and whether it is offered at all.
   *
   * Only after going back: the row in effect has to be a saved one that is not
   * the top of the list — which is exactly the state you are in having pressed
   * an older row. On the newest there is nothing to go back TO, and a live
   * button there reads as an offer to undo something you are in the middle of.
   * (What is applied and not saved is dropped by going back to the save under
   * it, which is that same press from that same row.)
   */
  const inEffect = rows.findIndex(
    (r) => r.definition === currentDefinition && r.rule === currentRule
  );
  const target = inEffect > 0 && rows[inEffect]?.version != null ? rows[inEffect] : null;
  const dropping = target ? inEffect : 0;
  const landsOnNewestSave = target != null && target === rows.find((r) => r.version != null);

  // Nothing written here yet — a heading over an empty box is furniture. The
  // one exception is a configuration with something applied and a save to go
  // back to: the way back has to be reachable before there is a list.
  if (versions.length === 0 && !pending && !onRevert) return null;

  return (
    <div className="border-t border-[hsl(var(--border))] pt-1.5">
      <div className="flex items-center gap-2">
        {/* A heading, and only a control when there is something behind it: a
            dead chevron over a list that is already all of itself is a
            promise of more. */}
        {more ? (
          <button
            type="button"
            onClick={() => {
              setNow(Date.now());
              setAll((v) => !v);
            }}
            title={all ? `Show the ${SHOWN} newest` : `Show all ${rows.length}`}
            className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {all ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Version history
            <span className="tabular-nums font-normal">{rows.length}</span>
          </button>
        ) : (
          <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Version history
            {rows.length > 0 && <span className="tabular-nums font-normal">{rows.length}</span>}
          </span>
        )}
        <span className="flex-1" />
        {/* Beside the list, because the list is where the thing it goes back
            TO is. It is not one of the three verbs on the row above: those act
            on what is being written, and this discards it. */}
        {onRevert && target && dropping > 0 && (
          <Revert
            to={target.versionNo}
            dropping={dropping}
            onRevert={() =>
              onRevert(landsOnNewestSave ? null : target.version?.configVersionNo ?? null)
            }
          />
        )}
      </div>

      {rows.length > 0 && (
        // Capped and scrolling: a long history must not push the boxes it is
        // about off the screen.
        <ul className="mt-1 max-h-[12rem] overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
          {shown.map((version, i) => {
            const isCurrent =
              version.version != null &&
              version.definition === currentDefinition &&
              version.rule === currentRule;
            // The pending row, and it is what the board is answering with —
            // as opposed to set aside while an older row is being read.
            const isLive =
              version.version == null &&
              version.definition === currentDefinition &&
              version.rule === currentRule;
            // Newest first, so the one after it in the list is the one before
            // it in time. The oldest has nothing to differ from.
            return (
              <li key={version.key}>
                <button
                  type="button"
                  /* Nothing to press only when this row is what is running:
                     applying what is applied does nothing. Set aside, the
                     pending row is a way back to your own work. */
                  disabled={disabled || (version.version == null && (isLive || !onPutBack))}
                  onClick={
                    version.version
                      ? () => onPick(version.version!)
                      : isLive || !onPutBack
                        ? undefined
                        : () => onPutBack()
                  }
                  title={
                    version.version
                      ? 'Put this wording back and apply it'
                      : isLive
                        ? 'This is what is in effect — Save keeps it as this version'
                        : 'Your unsaved wording — put it back and apply it'
                  }
                  /* The row being read has to win against the row under the
                     pointer. A 5% tint lost to the hover grey, which is the
                     one thing it is next to — so it takes the accent colour
                     properly and a bar down its edge, and the transparent bar
                     on every other row keeps the text from stepping sideways
                     as the reading moves. */
                  /* Centres, not baselines: the count is a pill with its own
                     box, and hanging it off the text's baseline sat it a
                     pixel low against everything else on the row. */
                  className={`flex w-full items-center gap-1.5 border-l-2 pl-1.5 pr-2 py-1 text-left ${
                    isCurrent || isLive
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/15'
                      : 'border-transparent hover:bg-[hsl(var(--muted))] disabled:hover:bg-transparent'
                  } ${disabled ? 'opacity-50' : ''}`}
                >
                  <span className="shrink-0 text-2xs font-bold tabular-nums text-[hsl(var(--muted-foreground))]">
                    v{version.versionNo}
                  </span>
                  {/* Blank until the model's label arrives, and for good if it
                      never does. Falling back to the time printed it twice on
                      the same row; the number and the time are enough to say
                      which version this is. */}
                  <span className="flex-1 truncate text-xs">{version.name ?? ''}</span>
                  {/* What that wording catches. Matches rather than ownership:
                      what an intent ends up holding depends on what sits above
                      it too, and the question a history answers is about the
                      words on the row — did widening this catch more. */}
                  {version.matches != null && (
                    <QuestionCount
                      value={version.matches}
                      title={`${questionsThat(
                        version.matches,
                        'matches this wording',
                        'match this wording'
                      )} — not the same as how many end up here, since an intent above can take one first`}
                    />
                  )}
                  <span
                    className={`shrink-0 w-[3.5rem] text-right text-2xs ${
                      isCurrent || isLive
                        ? 'font-semibold text-[hsl(var(--primary))]'
                        : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    {version.createdAt == null
                      ? isLive
                        ? 'unsaved'
                        : 'set aside'
                      : isCurrent
                        ? 'current'
                        : ago(version.createdAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Go back to a version, dropping what came after it.
 *
 * It asks first, and the question names both halves — where it lands and how
 * much goes — because what it drops is work, minutes of it sometimes, and it
 * sits one press away from a list whose every other press is reversible.
 */
function Revert({
  onRevert,
  to,
  dropping,
}: {
  onRevert: () => void;
  to: number;
  dropping: number;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        title={`Take the whole setup back to v${to}, dropping everything saved or applied after it`}
        className="shrink-0 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold hover:bg-[hsl(var(--muted))]"
      >
        Revert
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-2xs text-[hsl(var(--muted-foreground))]">
        Back to v{to}, dropping {dropping} later — the whole setup?
      </span>
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          onRevert();
        }}
        className="rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold text-rose-600 hover:bg-[hsl(var(--muted))] dark:text-rose-400"
      >
        Drop
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="rounded px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
      >
        Cancel
      </button>
    </span>
  );
}
