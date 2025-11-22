export function eventRace(
  { single, double }: { single: Function; double: Function },
  time = 200,
) {
  let timeout: NodeJS.Timeout | null = null;

  return () => {
    if (timeout) {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      double();
    } else {
      timeout = setTimeout(() => {
        single();
        timeout = null;
      }, time);
    }
  };
}
