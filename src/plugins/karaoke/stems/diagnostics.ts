// A small record of what capture and separation did, kept in the app's data folder.
// Most of what can go wrong only shows up over hours of real listening.

const EARLY_LINES_KEPT = 300;

type Sink = (line: string) => void;

let sink: Sink | null = null;
const early: string[] = [];

export const log = (message: string) => {
  const line = `${new Date().toISOString()} ${message}`;
  if (sink) sink(line);
  else if (early.length < EARLY_LINES_KEPT) early.push(line);
};

/** The tap starts before plugins do, so its first lines wait here. */
export const setLogSink = (next: Sink | null) => {
  sink = next;
  if (next) early.splice(0).forEach(next);
};
