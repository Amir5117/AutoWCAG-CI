import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

function githubAppCredentials() {
  return {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientId: process.env.GITHUB_CLIENT_ID,
  };
}

export async function getOctokitForRepo(owner: string, repo: string) {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: githubAppCredentials(),
  });

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({
    owner,
    repo,
  });

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      ...githubAppCredentials(),
      installationId: installation.id,
    },
  });
}
