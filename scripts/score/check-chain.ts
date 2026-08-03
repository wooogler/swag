/**
 * P0 acceptance: exercise the v7 chain compiler + router against the cases the
 * design doc pins down (docs/SCORE_v7_intent_tree_design.md §3.3), plus the
 * degenerate trees the compiler promises to survive.
 *
 * Pure functions only — no DB, no env, no LLM:
 *   npx tsx scripts/score/check-chain.ts
 */
import {
  compileChains,
  resolveRoute,
  type ChainNode,
  type RatingLevel,
  type ScoreQueryType,
} from '../../src/lib/score/intents';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

/** Terse node builder: id, parent, position all optional. */
function intent(
  id: number,
  opts: { parent?: number | null; position?: number | null; type?: ScoreQueryType } = {}
): ChainNode {
  return {
    id,
    kind: 'intent',
    type: opts.type ?? 'planning',
    parentIntentId: opts.parent ?? null,
    position: opts.position ?? null,
  };
}

function root(id: number, type: ScoreQueryType): ChainNode {
  return { id, kind: 'type_root', type, parentIntentId: null, position: null };
}

function orderOf(nodes: ChainNode[], type: ScoreQueryType = 'planning'): number[] {
  return compileChains(nodes).get(type)!.order;
}

console.log('\ncompileChains — design doc §3.3');
{
  // T{ A{B, C}, D } → [B, C, A, D]  (root is the else, not in `order`)
  const nodes = [
    root(1, 'planning'),
    intent(10), // A
    intent(11, { parent: 10 }), // B
    intent(12, { parent: 10 }), // C
    intent(13), // D
  ];
  check('T{A{B,C},D} → [B,C,A,D]', orderOf(nodes), [11, 12, 10, 13]);
  check('root is the else', compileChains(nodes).get('planning')!.rootId, 1);
}
{
  // T{ A{B}, D{E} } → [B, A, E, D] — sibling SUBTREES stay whole (not a global
  // depth sort, which would give [B, E, A, D]).
  const nodes = [
    root(1, 'planning'),
    intent(10), // A
    intent(11, { parent: 10 }), // B
    intent(20), // D
    intent(21, { parent: 20 }), // E
  ];
  check('T{A{B},D{E}} → [B,A,E,D]', orderOf(nodes), [11, 10, 21, 20]);
}
{
  // Three levels: children before parents all the way up.
  const nodes = [
    root(1, 'planning'),
    intent(10),
    intent(11, { parent: 10 }),
    intent(12, { parent: 11 }),
  ];
  check('deep nesting → [12,11,10]', orderOf(nodes), [12, 11, 10]);
}

console.log('\ncompileChains — parents, order, scoping');
{
  const nodes = [root(1, 'planning'), intent(10, { parent: 1 }), intent(11)];
  check('parentIntentId === rootId is top-level', orderOf(nodes), [10, 11]);
}
{
  // position wins over id; untouched siblings keep creation order.
  const nodes = [
    root(1, 'planning'),
    intent(10),
    intent(11),
    intent(12, { position: 10.5 }), // between 10 and 11
  ];
  check('fractional position orders siblings', orderOf(nodes), [10, 12, 11]);
}
{
  const nodes = [
    root(1, 'planning'),
    root(2, 'reviewing'),
    intent(10, { type: 'planning' }),
    intent(20, { type: 'reviewing' }),
  ];
  const chains = compileChains(nodes);
  check('planning chain', chains.get('planning')!.order, [10]);
  check('reviewing chain', chains.get('reviewing')!.order, [20]);
  check('empty type still present', chains.get('drafting')!.order, []);
  check('empty type has no root', chains.get('drafting')!.rootId, null);
}
{
  const nodes: ChainNode[] = [
    root(1, 'planning'),
    { id: 5, kind: 'prompt_holder', type: null, parentIntentId: null, position: null },
    { id: 6, kind: 'intent', type: null, parentIntentId: null, position: null }, // un-backfilled
    intent(10),
  ];
  check('holder + untyped intent are not routable', orderOf(nodes), [10]);
}

console.log('\ncompileChains — degenerate trees stay total');
{
  const nodes = [root(1, 'planning'), intent(10, { parent: 999 })]; // missing parent
  check('orphan → top-level', orderOf(nodes), [10]);
}
{
  const nodes = [
    root(1, 'planning'),
    root(2, 'reviewing'),
    intent(10, { type: 'planning' }),
    intent(20, { type: 'reviewing', parent: 10 }), // parent in another type
  ];
  check('cross-type parent → top-level of own type', orderOf(nodes, 'reviewing'), [20]);
}
{
  const nodes = [
    root(1, 'planning'),
    intent(10, { parent: 11 }),
    intent(11, { parent: 10 }), // 2-cycle: neither is top-level
  ];
  check('cycle → both still routable', orderOf(nodes), [10, 11]);
}
{
  check('no nodes at all', orderOf([]), []);
}

console.log('\nresolveRoute — CONTAINMENT (a subset only owns what its parents own)');
{
  const nodes = [root(1, 'planning'), intent(10), intent(11, { parent: 10 })];
  const chain = compileChains(nodes).get('planning')!; // order [11, 10]
  const r = (entries: [number, RatingLevel][]) => resolveRoute(chain, new Map(entries));

  check('ancestors recorded', chain.ancestorsOf.get(11), [10]);
  check('top-level has none', chain.ancestorsOf.get(10), []);

  check('parent in, child in → child (the subset refines it)', r([[10, 'clearly_in'], [11, 'clearly_in']]), {
    kind: 'matched',
    intentId: 11,
  });
  check('parent in, child out → parent', r([[10, 'clearly_in'], [11, 'clearly_out']]), {
    kind: 'matched',
    intentId: 10,
  });
  // THE case the containment rule exists for.
  check('parent OUT, child in → nobody (child cannot escape its parent)', r([[10, 'clearly_out'], [11, 'clearly_in']]), {
    kind: 'type_default',
    intentId: 1,
  });
  check('parent unrated → pending, even though the child matched', r([[11, 'clearly_in']]), {
    kind: 'pending',
  });
  check("ineligible child's own rating is never needed", r([[10, 'clearly_out']]), {
    kind: 'type_default',
    intentId: 1,
  });
}
{
  // Containment is transitive: a grandchild needs the whole ancestry.
  const nodes = [root(1, 'planning'), intent(10), intent(11, { parent: 10 }), intent(12, { parent: 11 })];
  const chain = compileChains(nodes).get('planning')!; // order [12, 11, 10]
  check('grandchild ancestry', chain.ancestorsOf.get(12), [11, 10]);
  const r = (e: [number, RatingLevel][]) => resolveRoute(chain, new Map(e));
  check('all three in → grandchild', r([[10, 'clearly_in'], [11, 'clearly_in'], [12, 'clearly_in']]), {
    kind: 'matched',
    intentId: 12,
  });
  check('grandparent out → grandchild blocked, falls through', r([[10, 'clearly_out'], [11, 'clearly_in'], [12, 'clearly_in']]), {
    kind: 'type_default',
    intentId: 1,
  });
}
{
  // A blocked subtree must not stop a LATER sibling from winning.
  const nodes = [root(1, 'planning'), intent(10), intent(11, { parent: 10 }), intent(20)];
  const chain = compileChains(nodes).get('planning')!; // order [11, 10, 20]
  const res = resolveRoute(
    chain,
    new Map<number, RatingLevel>([[10, 'clearly_out'], [11, 'clearly_in'], [20, 'clearly_in']])
  );
  check('blocked subtree yields to the next sibling', res, { kind: 'matched', intentId: 20 });
}

console.log('\nresolveRoute — basics');
{
  const nodes = [root(1, 'planning'), intent(10), intent(11, { parent: 10 })];
  const chain = compileChains(nodes).get('planning')!; // order [11, 10]
  const r = (entries: [number, RatingLevel][]) => resolveRoute(chain, new Map(entries));

  check('child wins over its parent', r([[11, 'clearly_in'], [10, 'clearly_in']]), {
    kind: 'matched',
    intentId: 11,
  });
  check('parent matches when child does not', r([[11, 'clearly_out'], [10, 'clearly_in']]), {
    kind: 'matched',
    intentId: 10,
  });
  check('nothing matches → type default', r([[11, 'clearly_out'], [10, 'clearly_out']]), {
    kind: 'type_default',
    intentId: 1,
  });
  check('probably_in does not match', r([[11, 'probably_in'], [10, 'probably_out']]), {
    kind: 'type_default',
    intentId: 1,
  });
  check('gap before any match → pending', r([[10, 'clearly_in']]), { kind: 'pending' });
}
{
  // "A gap after the winner is irrelevant" needs TOP-LEVEL siblings now: for a
  // subset, an unrated parent is a gap BEFORE it (it decides eligibility).
  const chain = compileChains([root(1, 'planning'), intent(10), intent(20)]).get('planning')!;
  check(
    'gap AFTER the winner is irrelevant',
    resolveRoute(chain, new Map<number, RatingLevel>([[10, 'clearly_in']])),
    { kind: 'matched', intentId: 10 }
  );
}
{
  const nodes = [root(1, 'planning'), intent(10), intent(11, { parent: 10 })];
  const chain = compileChains(nodes).get('planning')!;
  const r = (entries: [number, RatingLevel][]) => resolveRoute(chain, new Map(entries));
  check('empty chain → type default', resolveRoute(compileChains([root(1, 'planning')]).get('planning')!, new Map()), {
    kind: 'type_default',
    intentId: 1,
  });
  check(
    'no root ensured yet → type default with null',
    resolveRoute(compileChains([]).get('planning')!, new Map()),
    { kind: 'type_default', intentId: null }
  );
}

console.log(failures === 0 ? '\nAll chain checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
