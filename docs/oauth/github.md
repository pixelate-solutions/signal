# GitHub OAuth, deploy runner, and registry commissioning

Signal uses three distinct GitHub credentials. Do not reuse one credential for all three jobs.

## User connection OAuth app

Create an organization-owned OAuth App under `pixelate-solutions` for each environment:

- Homepage URL: the environment's public Signal URL.
- Authorization callback URL: `https://<signal-api-host>/v1/connections/callback`.
- Device flow: disabled; Signal uses the web authorization-code flow with PKCE and signed one-use state.

Set its client ID as `GITHUB_OAUTH_CLIENT_ID` and secret as `GITHUB_OAUTH_CLIENT_SECRET` in the private runtime input JSON. GitHub OAuth Apps accept one callback URL, so staging and production need separate apps. GitHub documents the exact fields in [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

The native V1 issue adapter requests the `repo` OAuth scope because it can create and verify issues in private repositories. If the desired production policy is public repositories only, narrow the adapter and consent scope together before approval.

## Actions Runner Controller GitHub App

Create a separate organization-owned GitHub App for the private EKS deploy runner scale set. Follow GitHub's [ARC authentication guide](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/authenticate-to-the-api) and select the minimum repository/organization runner permissions it specifies. Install the app only on `pixelate-solutions/signal`.

Record:

- the numeric App ID as `GITHUB_RUNNER_APP_ID`;
- the numeric installation ID as `GITHUB_RUNNER_INSTALLATION_ID`;
- the downloaded PEM private key contents as `GITHUB_RUNNER_PRIVATE_KEY`.

The commissioning script publishes those fields through External Secrets to ARC. Staging and production create distinct scale sets named `signal-deploy-staging` and `signal-deploy-production`.

## GHCR pull identity

The cluster also needs a machine identity that can pull the private `ghcr.io/pixelate-solutions/signal-*` images:

- `GHCR_USERNAME`: the machine-user login.
- `GHCR_PULL_TOKEN`: a classic PAT with `read:packages` and organization SSO authorization when required.

GitHub currently requires a classic PAT for direct Container Registry authentication and documents `read:packages` for downloads in [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). Store the PAT only in the private runtime input; the cluster receives a generated `kubernetes.io/dockerconfigjson` ExternalSecret.

## Staging evidence

Connect a staging user account, create a disposable issue through Signal, verify the read-after-write receipt and idempotency marker, reauthenticate, then revoke. Separately confirm that each ARC scale set registers an ephemeral runner and that a pod can pull every digest-pinned release image.
