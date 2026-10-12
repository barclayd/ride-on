type Range = {
  axisNames: string[];
  shape: number[];
  values: (number | null)[];
};
export type BpfPacking = 'declared' | 'time-first';

export const bpfOffset = (
  range: Range,
  selectionAxis: string,
  time: number,
  selection: number,
  packing: BpfPacking,
) => {
  if (packing === 'time-first')
    return (
      time * (range.shape[range.axisNames.indexOf(selectionAxis)] ?? 0) +
      selection
    );
  let offset = 0;
  for (let i = 0; i < range.axisNames.length; i++) {
    const name = range.axisNames[i];
    offset =
      offset * (range.shape[i] ?? 0) +
      (name === 't' ? time : name === selectionAxis ? selection : 0);
  }
  return offset;
};

/** A BPF v2 response observed on 2026-10-12 advertised statistic/time axes but
 * packed each hour's statistics together. Prove the packing using ordered
 * quantiles (or exceedance probabilities); never guess from plausible weather.
 * Single-hour probes independently confirmed the time-first interpretation.
 */
export const bpfPacking = (
  evidence: {
    range: Range;
    selectionAxis: string;
    selections: (string | number)[];
    timeCount: number;
    probability: boolean;
  }[],
): BpfPacking => {
  const valid = { declared: true, 'time-first': true };
  let equivalent = true;
  for (const {
    range,
    selectionAxis,
    selections,
    timeCount,
    probability,
  } of evidence) {
    if (
      range.axisNames.length !== range.shape.length ||
      range.shape.reduce((a, b) => a * b, 1) !== range.values.length ||
      range.shape[range.axisNames.indexOf('t')] !== timeCount ||
      range.shape[range.axisNames.indexOf(selectionAxis)] !==
        selections.length ||
      range.axisNames.some(
        (name, i) =>
          name !== 't' && name !== selectionAxis && range.shape[i] !== 1,
      )
    )
      throw new Error('Invalid forecast dimensions');
    const ordered = selections
      .map((label, index) => {
        const match = probability
          ? /^>(=?)([+-]?[\d.]+(?:E[+-]?\d+)?)$/i.exec(String(label))
          : null;
        const value = probability ? Number(match?.[2]) : Number(label);
        if (
          !Number.isFinite(value) ||
          (!probability && (value < 0 || value > 100))
        )
          throw new Error('Unknown statistic order');
        return { value, index, strict: match?.[1] === '' ? 1 : 0 };
      })
      .sort((a, b) => a.value - b.value || a.strict - b.strict);
    const selected = selections.findIndex((v) =>
      probability ? v === '>0.0' : Number(v) === 50,
    );
    for (let t = 0; t < timeCount; t++) {
      for (const packing of ['declared', 'time-first'] as const) {
        let previous: number | null = null;
        for (const { index } of ordered) {
          const value =
            range.values[bpfOffset(range, selectionAxis, t, index, packing)] ??
            null;
          if (value === null) continue;
          if (
            previous !== null &&
            (probability ? value > previous + 1e-8 : value < previous - 1e-8)
          )
            valid[packing] = false;
          previous = value;
        }
      }
      if (
        selected >= 0 &&
        range.values[
          bpfOffset(range, selectionAxis, t, selected, 'declared')
        ] !==
          range.values[
            bpfOffset(range, selectionAxis, t, selected, 'time-first')
          ]
      )
        equivalent = false;
    }
  }
  if (valid.declared && valid['time-first'] && equivalent) return 'declared';
  if (valid.declared !== valid['time-first'])
    return valid.declared ? 'declared' : 'time-first';
  throw new Error('Ambiguous or inconsistent forecast packing');
};
