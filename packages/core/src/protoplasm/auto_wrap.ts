/**
 * 🧬 PROTOPLASM — auto_wrap
 *
 * The closest thing to "every export gets probed" without a TS compiler plugin.
 *
 * Usage:
 *   import * as authMod from "./auth.js";
 *   const wrapped = autoWrapModule("auth", authMod, cfg);
 *   export const { lookupUser, signIn, signOut } = wrapped;
 *
 * Or as proxy:
 *   const m = autoWrapModuleProxy("auth", authMod, cfg);
 *   m.lookupUser(...)   // automatically probed
 *
 * Skips properties: non-functions, properties starting with "_" (private convention),
 * and a configurable skip list.
 */

import { withSuperQuanProbe } from "./super_quan_probe.js";
import type { ProtoplasmConfig } from "./types.js";

export interface AutoWrapOptions {
  cfg?: ProtoplasmConfig;
  skip?: string[];
  prefix?: string;
}

/** Returns a NEW object where every function export is wrapped with super_quan_probe.
 *  Non-function properties pass through unchanged. */
export function autoWrapModule<T extends Record<string, any>>(
  moduleName: string,
  mod: T,
  opts: AutoWrapOptions = {},
): T {
  const skip = new Set(opts.skip ?? []);
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(mod)) {
    if (skip.has(key) || key.startsWith("_") || typeof value !== "function") {
      result[key] = value;
      continue;
    }
    const fnId = `${opts.prefix ?? moduleName}.${key}`;
    result[key] = withSuperQuanProbe(fnId, value, opts.cfg);
  }
  return result as T;
}

/** Same idea via Proxy — wraps lazily, no upfront enumeration cost.
 *  Returns proxy that intercepts function-call sites. */
export function autoWrapModuleProxy<T extends Record<string, any>>(
  moduleName: string,
  mod: T,
  opts: AutoWrapOptions = {},
): T {
  const skip = new Set(opts.skip ?? []);
  const cache = new Map<string, any>();
  return new Proxy(mod, {
    get(target, prop, receiver) {
      const key = String(prop);
      const value = Reflect.get(target, prop, receiver);
      if (skip.has(key) || key.startsWith("_") || typeof value !== "function") return value;
      if (cache.has(key)) return cache.get(key);
      const fnId = `${opts.prefix ?? moduleName}.${key}`;
      const wrapped = withSuperQuanProbe(fnId, value, opts.cfg);
      cache.set(key, wrapped);
      return wrapped;
    },
  }) as T;
}

/** Wrap every function in a class prototype (instance methods).
 *  Returns a NEW class extending the original, with each method wrapped. */
export function autoWrapClass<T extends new (...args: any[]) => any>(
  className: string,
  Cls: T,
  opts: AutoWrapOptions = {},
): T {
  const skip = new Set([...(opts.skip ?? []), "constructor"]);
  const proto = Cls.prototype;
  const wrappedClass = class extends Cls {} as T;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (skip.has(key) || key.startsWith("_")) continue;
    const value = proto[key];
    if (typeof value !== "function") continue;
    const fnId = `${opts.prefix ?? className}.${key}`;
    (wrappedClass.prototype as any)[key] = withSuperQuanProbe(fnId, value, opts.cfg);
  }
  return wrappedClass;
}
