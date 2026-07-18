# Runbook: mobile production release

Signal uses EAS Build/Submit with separate consumer and managed-enterprise profiles. Production config fails closed if any public endpoint or identity value is missing.

## EAS project and environment

From [`apps/mobile`](../../apps/mobile), create/link the EAS project and store these values in the EAS **production** environment:

| Variable                        | Value                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| `EAS_PROJECT_ID`                | EAS project UUID                                              |
| `EXPO_PUBLIC_API_URL`           | `https://<signal-api-host>`                                   |
| `EXPO_PUBLIC_OIDC_ISSUER`       | Public HTTPS OIDC issuer                                      |
| `EXPO_PUBLIC_OIDC_CLIENT_ID`    | Public native client ID, normally `signal-mobile`             |
| `EXPO_PUBLIC_OIDC_REDIRECT_URI` | `signal://oauth/callback`                                     |
| `EXPO_PUBLIC_LINK_HOST`         | Universal/app-link host, normally `signal.pixelate.solutions` |

`EXPO_PUBLIC_*` values are embedded in the app and must never contain secrets. Register `signal://oauth/callback` on the OIDC native/public client. Publish `apple-app-site-association` and `/.well-known/assetlinks.json` for the link host with the final Apple Team ID, bundle IDs, Android package IDs, and signing certificate digests.

## Signing and stores

1. Configure Apple credentials for `solutions.pixelate.signal` and Google Play credentials for the same consumer product identity.
2. Configure the APNs entitlement/key and Firebase Android application for the signed identifiers.
3. Complete privacy nutrition labels/data-safety forms, export compliance, support/privacy URLs, screenshots, age rating, and account-deletion review instructions.
4. Run physical-device acceptance for sign-up, refresh, recovery, passkey, biometric lock, OAuth return, scan/share/voice, push foreground/background/terminated, exact-card routing, offline return, and account deletion.
5. Configure the `production` submit profile/store connections. Android's first Play upload may require one manual submission before API submission is accepted.

The checked-in EAS workflow at [`apps/mobile/.eas/workflows/deploy-production.yml`](../../apps/mobile/.eas/workflows/deploy-production.yml) runs on `v*` tags, builds both platforms, and requires an explicit EAS approval before store submission. Expo documents the current [EAS production workflow](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/) and [production environment variables](https://docs.expo.dev/eas/environment-variables/).

After linking the EAS project, validate the checked-in workflow from the repository root with `pnpm dlx eas-cli@latest workflow:validate apps/mobile/.eas/workflows/deploy-production.yml --non-interactive`. The validator requires an authenticated EAS session or `EXPO_TOKEN`; CI/build submission must use a scoped operator-owned token rather than a value committed to Git.

The `enterprise` profile uses distinct bundle/package identifiers and internal distribution. It must have separate MDM policy, signing, privacy disclosure, and device-action testing; it is never submitted as the consumer store build.
