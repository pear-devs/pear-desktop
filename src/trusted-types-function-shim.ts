/**
 * YouTube Music sets a strict Trusted Types default policy. Some bundled code
 * still calls `new Function(body)` / `Function(body)` with a plain string; Chromium
 * then blocks it. Wrap the body with `createScript` so dynamic code can compile.
 *
 * Must run before other renderer imports that might trigger this at load time.
 */
function installTrustedTypesFunctionShim(): void {
  if (typeof window === 'undefined') return;

  const tt = window.trustedTypes;
  if (!tt?.createPolicy) return;

  let policy: Pick<
    TrustedTypePolicy,
    'createScript' | 'createHTML' | 'createScriptURL'
  >;
  try {
    policy = tt.createPolicy('pear-dynamic-script', {
      createScript: (input: string) => input,
      createHTML: (input: string) => input,
      createScriptURL: (input: string) => input,
    });
  } catch {
    return;
  }

  const Original = window.Function;

  const wrapArgs = (argArray: unknown[]): unknown[] => {
    if (argArray.length === 0) return argArray;
    const last = argArray[argArray.length - 1];
    if (typeof last !== 'string') return argArray;
    const trustedBody = policy.createScript(last);
    return [...argArray.slice(0, -1), trustedBody];
  };

  const Proxied = new Proxy(Original, {
    apply(_target, thisArg, argArray: unknown[]) {
      return Reflect.apply(Original, thisArg, wrapArgs(argArray) as never[]);
    },
    construct(_target, argArray: unknown[], newTarget) {
      return Reflect.construct(
        Original,
        wrapArgs(argArray) as never[],
        newTarget,
      );
    },
  }) as typeof Function;

  Object.defineProperty(Proxied, 'prototype', {
    value: Original.prototype,
    configurable: true,
  });

  window.Function = Proxied;
}

installTrustedTypesFunctionShim();
