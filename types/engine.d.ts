// The vendored engine is plain ESM JavaScript. These are the only four modules
// we reach into; everything else is reached over HTTP through the worker.

declare module '@/engine/worker/index.mjs' {
  export function handle(
    request: Request,
    env: Record<string, unknown>,
    ctx: unknown,
  ): Promise<Response>;
}

declare module '@/engine/src/library.mjs' {
  export function library(root?: string): unknown;
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
