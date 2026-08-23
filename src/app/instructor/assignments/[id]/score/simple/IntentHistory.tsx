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
 * NUMBERED PER INTENT. v1 is this intent's first wording, whatever the rest of
 * the setup had done by then, and a new intent starts at v1 on a board that
 * has saved ten times. The whole setup has its own count — the reply's picker
 * and the banner call those "setup 3" — because two things counting different
 * runs of events cannot both be "v".
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
 * PRESSING A ROW SHOWS THAT VERSION, on the whole board and read-only: the
 * boxes fill with what it said, the question list is the list it produced,
 * and the conversation answers out of it. Nothing is written — a banner at the
 * top of the column says which version is on screen, and offers the way back
 * to the newest and the way to make this one newest again.
 *
 * It used to APPLY the row instead, which cost more than it gave: it clobbered
 * whatever was in the boxes, and looking at v1 wrote a v3 that WAS v1, since
 * an apply is a write and the board grows a moment for it, numbered next and
 * carrying the same words.
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
  /** The configuration as delivered, which no row in any table holds. */
  floor?: boolean;
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
  pending = null,
  delivered = false,
  onView,
  viewingVersionNo = null,
  onRestore = null,
  viewingLabel = null,
}: {
  versions: IntentVersion[];
  /**
   * There is something applied and not saved for this intent.
   *
   * It survives going off to read an older version — work that has not been
   * saved is still work, and a list that drops it the moment you look
   * elsewhere is a list you cannot look away from. Pressing it comes back to
   * the newest, which is where that work is.
   */
  pending?: {
    name: string | null;
    /** What this wording catches, when the board is on it to know. */
    matches: number | null;
  } | null;


  /**
   * Put the whole board into this version and read it there. Null means the
   * newest, which is where editing happens.
   */
  /**
   * This list stands on the configuration AS DELIVERED — true for the rule
   * that answers everything else, and for the one-document arm, where the
   * board opens on a prompt somebody else wrote. An intent has no such floor:
   * before its first wording it did not exist.
   */
  delivered?: boolean;
  onView: (configVersionNo: number | null) => void;
  /** Which version the board is showing, or null when it is on the newest. */
  viewingVersionNo?: number | null;
  /** Make the version on screen the newest one again — offered here, beside
   * the list that put the board there. */
  onRestore?: (() => void) | null;
  /** What that version is called, for the question it asks first. */
  viewingLabel?: number | null;
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
            // This intent's next, not the setup's: the number belongs to the
            // wording, and a save writes at most one per intent.
            versionNo: (versions[0]?.versionNo ?? 0) + 1,
            definition: '',
            rule: '',
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
      versionNo: v.versionNo,
      definition: v.definition,
      rule: v.rule,
      name: v.name,
      matches: v.matches,
      createdAt: v.createdAt,
      version: v,
    })),
    ...(delivered
      ? [
          {
            key: 'delivered',
            versionNo: 0,
            definition: '',
            rule: '',
            name: 'Original (as delivered)',
            matches: null,
            createdAt: null,
            version: null,
            floor: true,
          },
        ]
      : []),
  ];
  /*
   * The floor is v0, so nothing above it moves.
   *
   * It was v1 for a while, which pushed every wording up one and made the
   * first thing anybody wrote "v2" — a number that matches nothing stored and
   * nothing anyone did. Zero says what it is: the state before the first
   * version, which is exactly how it is stored.
   */
  const more = rows.length > SHOWN;
  const shown = all ? rows : rows.slice(0, SHOWN);

  /**
   * The row the board is showing: the newest when it is on the newest, and
   * otherwise whichever version is being read.
   */
  const showing =
    viewingVersionNo == null
      ? rows[0]
      : viewingVersionNo === 0
        ? // The delivered one holds no stored row to match against; it is the
          // only row that is its own version number.
          rows.find((r) => r.floor)
        : rows.find((r) => r.version?.configVersionNo === viewingVersionNo);

  // Nothing written here yet — a heading over an empty box is furniture.
  // Unless the list has a floor, which is there from the first moment: the
  // board opens on a prompt somebody else wrote, and that is v1.
  if (versions.length === 0 && !pending && !delivered) return null;

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
        {/* Where the press that moved the board was, rather than at the top of
            the column: the list is what is being read, and the two things to
            do about it are to keep this version or to stop reading. */}
        {viewingVersionNo != null && (
          <span className="flex shrink-0 items-center gap-1.5">
            {onRestore && <RestoreVersion to={viewingLabel ?? 0} onRestore={onRestore} />}
            <button
              type="button"
              onClick={() => onView(null)}
              title="Back to the newest, where editing happens"
              className="shrink-0 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold hover:bg-[hsl(var(--muted))]"
            >
              Latest
            </button>
          </span>
        )}
      </div>

      {rows.length > 0 && (
        // Capped and scrolling: a long history must not push the boxes it is
        // about off the screen.
        <ul className="mt-1 max-h-[12rem] overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
          {shown.map((version) => {
            const isCurrent = showing === version;
            return (
              <li key={version.key}>
                <button
                  type="button"
                  /* Never disabled: showing a version writes nothing, and it
                     is the one thing a read-only board is still for. */
                  onClick={() =>
                    onView(
                      version.floor
                        ? 0
                        : version.version?.configVersionNo ?? null
                    )
                  }
                  title={
                    version.floor
                      ? 'Show the board as this chatbot was delivered, before anything was changed'
                      : version.version
                        ? 'Show the whole board as it was in this version'
                        : 'Back to the newest, where editing happens'
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
                    isCurrent
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/15'
                      : 'border-transparent hover:bg-[hsl(var(--muted))]'
                  }`}
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
                      isCurrent
                        ? 'font-semibold text-[hsl(var(--primary))]'
                        : 'text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    {version.floor
                      ? isCurrent
                        ? 'showing'
                        : ''
                      : version.createdAt == null
                      ? 'unsaved'
                      : isCurrent
                        ? viewingVersionNo == null
                          ? 'current'
                          : 'showing'
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
 * Make the version on screen the newest one again.
 *
 * It asks first: everything saved or applied after this point leaves the
 * timeline, and "restore" on its own says where it lands but not what it
 * costs.
 */
function RestoreVersion({ to, onRestore }: { to: number; onRestore: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        title={
          to === 0
            ? 'Start again from this chatbot as it was delivered, dropping everything since'
            : `Make setup ${to} the newest again, dropping everything saved or applied after it`
        }
        className="shrink-0 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold hover:bg-[hsl(var(--muted))]"
      >
        Restore
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-2xs text-[hsl(var(--muted-foreground))]">
        {to === 0
          ? 'Back to the delivered chatbot, dropping everything since?'
          : `Back to setup ${to}, dropping what came after?`}
      </span>
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          onRestore();
        }}
        className="rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold text-rose-600 hover:bg-[hsl(var(--muted))] dark:text-rose-400"
      >
        Restore
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
