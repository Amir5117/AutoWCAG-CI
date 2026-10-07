import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

function githubAppCredentials() {
  return {
    appId: process.env.GITHUB_APP_ID,
    // .pem keys are typically stored in .env with literal "\n" sequences
    // instead of real newlines -- restore them or JWT signing fails.
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientId: process.env.GITHUB_CLIENT_ID,
  };
}

/**
 * Returns an Octokit client authenticated as the GitHub App's installation
 * on the given repo, so requests act with the App's installation-scoped
 * permissions rather than a personal access token.
 */
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
