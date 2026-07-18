# Google OAuth commissioning

`GOOGLE_OAUTH_CLIENT_ID` is the **OAuth 2.0 Web application client ID** created in Google Cloud. It is not a Firebase project ID, API key, service-account ID, iOS client ID, or Android client ID. A valid value normally looks like `123456789012-abc123.apps.googleusercontent.com`.

## Create the client

1. Use separate Google Cloud projects for staging and production. Enable the Gmail API and Google Calendar API.
2. Configure the OAuth consent screen with Pixelate Solutions' verified domain, support email, homepage, privacy policy, terms, and authorized production scopes.
3. Create **APIs & Services → Credentials → OAuth client ID → Web application**.
4. Add exactly this authorized redirect URI, with the actual Signal API hostname and no trailing slash:

   ```text
   https://<signal-api-host>/v1/connections/callback
   ```

   For example, if `APP_PUBLIC_URL=https://signal.pixelate.solutions`, enter `https://signal.pixelate.solutions/v1/connections/callback`.

5. Copy the generated client ID to `GOOGLE_OAUTH_CLIENT_ID` and the generated client secret to `GOOGLE_OAUTH_CLIENT_SECRET` in the private runtime input JSON based on [`infra/runtime-secret.example.json`](../../infra/runtime-secret.example.json). Never place either value in Git.

Google requires the runtime `redirect_uri` to exactly match an authorized URI, including scheme, case, path, and trailing slash. Signal uses the web-server authorization-code flow, PKCE, signed one-use state, offline access, refresh-token rotation/preservation, upstream revocation, and an encrypted credential handle. See Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

## Scopes and review

The native V1 adapters request only:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/calendar.events`

Keep the consent-screen scope list synchronized with enabled Signal tools. Google classifies sensitive and restricted scopes in the console; public apps requesting them must complete the applicable brand, sensitive-scope, or restricted-scope verification. Google documents the [verification process](https://support.google.com/cloud/answer/13463073) and recommends a separate project when testing new scopes before production approval ([changes to approved apps](https://support.google.com/cloud/answer/13464018)).

## Staging evidence

Before production promotion:

1. Publish or test the staging consent screen with an allowlisted staging account.
2. Connect Google from Signal Settings and confirm the callback returns to `signal://settings/connections`.
3. Run a Gmail read and an idempotent Calendar write/read-after-write task.
4. Run connection monitoring and confirm the Google provider is healthy.
5. Reauthenticate the connection and confirm the old encrypted credential is revoked.
6. Revoke the connection and confirm Google authorization is revoked upstream.

If Google reports `redirect_uri_mismatch`, compare the console value and `APP_PUBLIC_URL + /v1/connections/callback` character for character.
