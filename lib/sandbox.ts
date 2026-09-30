// Where a fix runs commands: one container per job, holding the repository at
// the commit the model reads, its dependencies installed, and then no network
// but a proxy that only reaches Google Fonts (next/font fetches at build time).
// No token and no API key ever go in — the model loop stays in the worker and
// only its commands do. Text comes out: output and exit codes. What the pull
// request holds is still the staged changes, never the container's files.
//
// FIX_SANDBOX names the CLI: `docker` or `podman`. Unset, fixes run as before,
// with nothing executed. FIX_SANDBOX_RUNTIME picks a runtime (`runsc` for
// gVisor) where one is installed.
//
// ponytail: the install step has open egress (the registry, and whatever the
// dependencies' install scripts reach), before the model has any say, and the
// disk has no quota. A registry mirror and a disk limit come with hosting, or
// with E2B / Vercel Sandbox in place of a local CLI.

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';

import type { Check, JobOutput } from './db.ts';

const IMAGE = 'seo-auditor-sandbox';
// Installs go out through NETWORK. After that a sandbox is only on OFFLINE, an
// internal network whose one way out is the EGRESS proxy (sandbox/egress.mjs).
const NETWORK = 'seo-auditor-sandbox';
const OFFLINE = 'seo-auditor-offline';
const EGRESS = 'seo-auditor-egress';
const ALLOWED = 'fonts.googleapis.com fonts.gstatic.com';
const PROXY = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].flatMap((v) => ['-e', `${v}=http://${EGRESS}:3128`]);
// The container's whole life: it runs `sleep`, so it ends on its own even if
// the worker dies. Builds are slow and the model's turns count too.
const MINUTES = Number(process.env.FIX_SANDBOX_MINUTES) || 30;
const COMMAND_SECONDS = 600;
const OUTPUT = 12_000;

export const sandboxCli = () => process.env.FIX_SANDBOX || null;

/** Run the container CLI. Output is stdout and stderr together, the tail kept. */
function cli(
  args: string[],
  o: { stdin?: string | Readable; signal?: AbortSignal } = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(sandboxCli()!, args, { signal: o.signal });
    let out = '';
    const keep = (chunk: string) => {
      out = (out + chunk).slice(-OUTPUT);
    };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    child.stdin.on('error', () => {}); // a command that exits without reading its input
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
    if (typeof o.stdin === 'object') o.stdin.pipe(child.stdin);
    else child.stdin.end(o.stdin ?? '');
  });
}

const must = async (run: Promise<{ code: number; out: string }>, step: string) => {
  const r = await run;
  if (r.code !== 0) throw new Error(`The sandbox failed ${step}: ${r.out.trim().split('\n').slice(-3).join(' ')}`);
  return r;
};

/** Build the image, the two networks and the egress proxy. The image is
 *  cached after the first time, which pulls Node and PHP and takes minutes. */
export async function prepareSandbox(): Promise<void> {
  // A file, not the directory: Turbopack resolves this URL when it bundles runner.ts for the web app.
  const dockerfile = fileURLToPath(new URL('../sandbox/Dockerfile', import.meta.url));
  await must(cli(['build', '-q', '-t', IMAGE, '-f', dockerfile, dirname(dockerfile)]), 'building its image');
  // Already there after the first time.
  await cli(['network', 'create', NETWORK]);
  await cli(['network', 'create', '--internal', OFFLINE]);
  await cli(['rm', '-f', EGRESS]);
  await must(
    cli([
      'run',
      '-d',
      '--init',
      '--name',
      EGRESS,
      '--network',
      NETWORK,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--memory',
      '256m',
      '-e',
      `ALLOWED=${ALLOWED}`,
      IMAGE,
      'node',
      '/opt/egress.mjs',
    ]),
    'starting its egress proxy',
  );
  await must(cli(['network', 'connect', OFFLINE, EGRESS]), 'connecting its egress proxy');
}

/** What to install, and which of the site's own scripts prove a change. */
export function plan(paths: string[], pkg: string | null): { install: string[] | null; scripts: string[][] } {
  if (pkg === null) return { install: null, scripts: [] };
  const has = (file: string) => paths.includes(file);
  const pm = has('bun.lock') || has('bun.lockb') ? 'bun' : has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(pkg).scripts ?? {};
  } catch {}
  return {
    install:
      pm === 'bun' || pm === 'pnpm'
        ? [pm, 'install', '--frozen-lockfile']
        : pm === 'yarn'
          ? ['yarn', 'install']
          : ['npm', has('package-lock.json') ? 'ci' : 'install'],
    scripts: ['build', 'lint'].filter((s) => typeof scripts[s] === 'string').map((s) => [pm, 'run', s]),
  };
}

/** A check that fails with the changes and did not fail without them. */
export const broke = (c: Check) => !c.ok && c.before !== false;

export type Box = Awaited<ReturnType<typeof openBox>>;

/** Start a container for one job and get the repository ready in it. */
export async function openBox(o: {
  id: string;
  /** The repository at the commit, as GitHub's tarball: one top directory. */
  tarball: Readable;
  paths: string[];
  pkg: string | null;
  signal: AbortSignal;
  say: (line: string) => void;
}) {
  const name = `seo-fix-${o.id.slice(0, 8)}`;
  const { install, scripts } = plan(o.paths, o.pkg);
  const runtime = process.env.FIX_SANDBOX_RUNTIME;
  // Through the proxy, except the install, which goes out directly.
  const exec = (argv: string[], stdin?: string | Readable, env = PROXY) =>
    cli(['exec', ...(stdin === undefined ? [] : ['-i']), ...env, name, 'timeout', '-k', '10', String(COMMAND_SECONDS), ...argv], {
      stdin,
      signal: o.signal,
    });

  // Put the checkout back to the commit, then lay the staged changes over it.
  // Whatever a command wrote to the source is gone; ignored files
  // (node_modules, build caches) stay.
  const sync = async (files: JobOutput['files']) => {
    await must(exec(['sh', '-c', 'git reset -q --hard && git clean -qfd']), 'resetting the checkout');
    for (const f of files) {
      await must(
        exec(['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', f.path], f.after),
        `writing ${f.path}`,
      );
    }
  };

  await must(
    cli(
      [
        'run',
        '-d',
        '--rm',
        '--init',
        '--name',
        name,
        '--network',
        NETWORK,
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--cpus',
        '2',
        '--memory',
        '4g',
        '--pids-limit',
        '512',
        ...(runtime ? ['--runtime', runtime] : []),
        IMAGE,
        'sleep',
        String(MINUTES * 60),
      ],
      { signal: o.signal },
    ),
    'starting',
  );
  const box = {
    /** Run a command on the commit plus `files`. Its own writes are thrown away. */
    async run(command: string, files: JobOutput['files']): Promise<string> {
      await sync(files);
      const r = await exec(['sh', '-c', command]);
      return `exit ${r.code}${r.code === 124 ? ' (timed out)' : ''}\n${r.out}`;
    },

    /** The checks we run ourselves, whatever the model says: `php -l` on every
     *  PHP file changed, then the site's build and lint. A script that fails
     *  is run again without the changes, so a build broken already is told
     *  apart from one these changes broke. */
    async verify(files: JobOutput['files']): Promise<Check[]> {
      const argvs = [...files.filter((f) => f.path.endsWith('.php')).map((f) => ['php', '-l', f.path]), ...scripts];
      if (!argvs.length) return [];
      await sync(files);
      const checks: Check[] = [];
      for (const argv of argvs) {
        const r = await exec(argv);
        checks.push({
          command: argv.join(' '),
          ok: r.code === 0,
          tail: r.out.slice(-3000),
        });
      }
      const again = checks.flatMap((c, i) => (!c.ok && argvs[i][0] !== 'php' ? [[c, argvs[i]] as const] : []));
      if (again.length) {
        await sync([]);
        for (const [c, argv] of again) c.before = (await exec(argv)).code === 0;
      }
      return checks;
    },

    close: () => cli(['rm', '-f', name]).catch(() => {}),
  };

  try {
    await must(exec(['tar', 'xz', '--strip-components=1'], o.tarball), 'unpacking the repository');
    // The commit, so `sync` can put it back. node_modules is excluded in case
    // the repository does not ignore it, or the reset would delete it.
    await must(
      exec([
        'sh',
        '-c',
        'git init -q && echo node_modules/ >> .git/info/exclude && git add -A && git -c user.name=sandbox -c user.email=sandbox@localhost commit -q --allow-empty --no-verify -m base',
      ]),
      'recording the commit',
    );
    if (install) {
      o.say(`installing dependencies: ${install.join(' ')}`);
      const r = await exec(install, undefined, []);
      if (r.code !== 0) o.say(`the install failed (exit ${r.code}), so builds will fail too: ${r.out.trim().split('\n').at(-1)}`);
    }
    // From here on it reaches nothing but Google Fonts, through the proxy.
    await must(cli(['network', 'connect', OFFLINE, name]), 'going offline');
    await must(cli(['network', 'disconnect', NETWORK, name]), 'going offline');
  } catch (err) {
    await box.close();
    throw err;
  }
  return box;
}
