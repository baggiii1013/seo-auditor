import { githubAccount } from '@/lib/db';
import { installationRepos, userInstallations } from '@/lib/github-app';
import { currentUser, userToken } from '@/lib/git-state';
import { store } from '@/lib/store';

// The import list: the accounts the app is installed on that the signed-in
// user can reach, and the repositories of one of them — `?installation=<id>`,
// or the first. One request for both, because switching account wants both.
// `login` too: it is how the panel learns a popup signed someone in.

export async function GET(request: Request) {
  const user = await currentUser();
  const token = user && (await userToken(user));
  if (!token) return Response.json({ error: 'Continue with GitHub first.' }, { status: 401 });

  const installs = await userInstallations(token);
  if (!installs.ok) return Response.json({ error: installs.reason }, { status: installs.status });

  const login = githubAccount(store(), user)?.login;
  const wanted = Number(new URL(request.url).searchParams.get('installation'));
  const pick = installs.value.find((i) => i.id === wanted) ?? installs.value[0];
  if (!pick) return Response.json({ login, installations: [], installation: null, repos: [] });

  const repos = await installationRepos(token, pick.id);
  if (!repos.ok) return Response.json({ error: repos.reason }, { status: repos.status });
  return Response.json({ login, installations: installs.value, installation: pick.id, repos: repos.value });
}
