// Symbol switches the controller performs poorly, with evidence and, where one
// was tested, a fix. Numbers are fractions of bodies that reach the second
// symbol.
//  - Walk -> Rear and Rear -> Walk: c2a/webdemo bridge tests (MuJoCo C, 48
//    start poses, 2026-10-10):
//      Walk -> Rear: 27-42% of walking bodies rear; 84-89% with 1 s Immobile.
//      Rear R -> Walk L: 69% walk; Rear -> Walk when the rear started from a
//      stop (Walk -> Immobile -> Rear -> Walk): 38%. A 1 s Turn R in between
//      gives 100% / 83%. Same-side Rear -> Walk is fine (88-96%).
//  - Others: the paper's pair test (2.5 s holds, 60 start poses),
//    outputs/behavior/impossible_transitions/mlb_s208_len500*/qualitative.csv.
import type { SymbolInfo } from './data';

export interface SwitchHint {
  message: string;
  fix?: { code: number; steps: number; label: string };
}

/** Hint for switching from `a` to `b`; `before` is the symbol preceding `a`. */
export function switchHint(
  before: SymbolInfo | null, a: SymbolInfo, b: SymbolInfo, symbols: SymbolInfo[],
): SwitchHint | null {
  const byName = (n: string) => symbols.find((s) => s.name === n)!;
  if (a.behavior === 'Walk' && b.behavior === 'Rear') {
    return {
      message: 'The rat usually keeps walking instead of rearing (roughly 1 in 3 rear). ' +
        'Rats in the training data stop before they rear; a 1 s Immobile in between raises this to about 9 in 10.',
      fix: { code: byName('Immobile').code, steps: 100, label: 'Insert 1 s Immobile' },
    };
  }
  if (a.behavior === 'Rear' && b.behavior === 'Walk') {
    const fromStop = before?.name === 'Immobile';
    const crossSide = a.name === 'Rear_R' && b.name === 'Walk_L';
    if (fromStop || crossSide) {
      return {
        message: fromStop
          ? 'After a rear that started from a stop, the rat often stays put or freezes (about 4 in 10 walk). ' +
            'A 1 s Turn R in between gets it walking about 8 times in 10.'
          : 'From a right rear, a left walk often stalls (about 7 in 10 walk). ' +
            'A 1 s Turn R in between fixes this.',
        fix: { code: byName('Turn_R').code, steps: 100, label: 'Insert 1 s Turn R' },
      };
    }
  }
  if (a.behavior === 'Walk' && b.name === 'Turn_R') {
    return { message: 'Walking into a right turn lands about 1 time in 3.' };
  }
  if (a.name === 'Immobile' && b.name === 'Turn_R') {
    return { message: 'A right turn from standing still lands about 1 time in 4 (the rat starts moving but rarely reads as turning).' };
  }
  if (a.name === 'Turn_R' && b.name === 'Rear_L') {
    return { message: 'Turning right into a left rear lands about 1 time in 4.' };
  }
  return null;
}
