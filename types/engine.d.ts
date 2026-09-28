// The vendored engine is plain ESM JavaScript. These are the only modules we
// reach into; everything else goes through the worker — see lib/engine.ts.

declare module '@/engine/worker/index.mjs' {
  export function handle(
    request: Request,
    env: Record<string, unknown>,
    ctx: unknown,
  ): Promise<Response>;
  /** The URL a run would audit, or why it will not. */
  export function targetFor(input: unknown, env: Record<string, unknown>): { url: string; error?: undefined } | { error: string };
}

declare module '@/engine/src/library.mjs' {
  export function library(root?: string): unknown;
  /** Where this application keeps what it manages, per platform — and what
   *  `SEO_AUDIT_HOME` overrides. The app's SQLite store sits beside the engine's
   *  reports in here rather than inventing a second location. */
  export function libraryRoot(env?: Record<string, string | undefined>, os?: string): string;
}

declare module '@/engine/src/options.mjs' {
  export type Field = {
    flag: string;
    query: string;
    type: 'number' | 'select' | 'checkbox' | 'url' | 'text' | 'agent';
    label: string;
    help?: string;
    placeholder?: string;
    value?: string;
    checked?: boolean;
    min?: number;
    which?: 'browser' | 'os';
    needs?: string;
    choices?: [string, string][];
  };
  export function formFields(allow?: (needs: string) => boolean): Field[];
  export function runParameters(): { flag: string; query: string }[];
  export function notInApp(): { flag: string; reason: string }[];
}

declare module '@/engine/src/agents.mjs' {
  export const BROWSER_NAMES: string[];
  export const OS_NAMES: string[];
}

declare module '@/engine/src/http.mjs' {
  /** Every fetch a crawl makes asks `fn` first; a string back refuses it. */
  export function guardFetches(fn: (url: string) => Promise<string | null>): void;
}
