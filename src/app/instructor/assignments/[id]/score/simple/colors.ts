/**
 * A colour per intent, so the tree and the question list can be read together.
 *
 * FOUR colours, not one per intent, and that is a measured limit rather than a
 * choice. Validated with the data-viz palette checker on the all-pairs list
 * (any two chips can end up side by side in a list, so every pair has to hold
 * up, not just neighbours): blue/amber/teal/fuchsia clears every gate — worst
 * pair ΔE 22.6 to normal vision, 9.7 under deuteranopia, all above 3:1 on the light
 * card. Every five-colour set tried fell to ΔE 12–15 somewhere, which means two
 * intents that look the same to a reader with full colour vision, and much
 * worse to the ~8% of men who do not have it. (The full version having exactly
 * four type colours is not a coincidence; four is about the ceiling.)
 *
 * So the colour is a SCANNING AID and never the identity. Every chip carries
 * the intent's name beside the dot, which is what actually tells them apart;
 * the colour is what lets you see, without reading, that a stretch of the list
 * all goes to the same place. Past the fourth intent the colours repeat, and a
 * repeat is a coincidence rather than a claim — the names still differ.
 *
 * Chosen to stay categorical rather than evaluative (§1-4: the board states
 * facts and does not warn). No red: whatever else a red dot beside a question
 * means to a reader, it means something is wrong with it.
 */

/**
 * In assignment order — the first intent written gets the first colour.
 *
 * Through CSS variables rather than hex, because the board follows the
 * participant's own `prefers-color-scheme` and a dark laptop gets the dark card
 * automatically. The dark steps are the same four hues re-stepped for that
 * surface and validated against it (globals.css), not an automatic flip: the
 * light steps put fuchsia at 2.75:1 there, which is a muddy dot.
 */
export const INTENT_COLORS = [
  'var(--intent-1)',
  'var(--intent-2)',
  'var(--intent-3)',
  'var(--intent-4)',
] as const;

/**
 * Keyed to the intent's stable id, NOT to its position.
 *
 * Reordering the tree is meant to be free — it changes which intent answers
 * first and costs no judgements — and repainting the whole board every time
 * someone moves a row would make a free act look expensive. An intent keeps its
 * colour through reorders, nesting, restores and version switches, for as long
 * as it exists.
 */
export function intentColor(sid: number): string {
  const i = (sid - 1) % INTENT_COLORS.length;
  return INTENT_COLORS[i < 0 ? i + INTENT_COLORS.length : i];
}
