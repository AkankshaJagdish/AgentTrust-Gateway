# Render deployment

AgentTrust Gateway currently uses Prisma with SQLite. The supplied Render Blueprint
attaches a persistent disk at `/var/data` and points Prisma to
`file:/var/data/agenttrust.db`. This preserves the existing SQLite implementation
without silently converting the application to PostgreSQL.

## Important operating constraints

- Render persistent disks require a paid web service. The Blueprint selects
  `1c-2g` and a 1 GB disk; confirm current pricing in your Render workspace before
  creating the service.
- A disk is attached to one service instance only. Do not scale this SQLite service
  horizontally. Render disables zero-downtime deploys for services with a disk.
- Render disks are available only at runtime, not during build or pre-deploy
  commands. The Blueprint therefore creates a temporary `build.db` for Prisma
  schema generation/build-time work, then the configured `start:render` command
  runs Prisma `db push` against the mounted `/var/data/agenttrust.db` before
  starting Next.js. The temporary build database is not the runtime database.
- This `db push` startup step is a bootstrap/workaround because the repository has
  not yet established a checked-in Prisma migration baseline. It is not a substitute
  for reviewed production migrations. Back up the disk before schema changes and
  establish a migration baseline before treating this as a long-lived production
  service.
- The deployment configuration is prepared in `render.yaml`; no Render service
  has been created or deployed by this repository change.

## Deploy from GitHub

1. Merge the deployment PR into `main`. The Blueprint is configured to deploy the `main` branch.
2. In Render, choose **New → Blueprint** and connect
   `AkankshaJagdish/AgentTrust-Gateway`.
3. Select `render.yaml` from the repository. Confirm the service is in Singapore
   and that the selected paid plan supports a persistent disk.
4. Enter the secret values requested by the Blueprint. Do not put them in GitHub,
   `render.yaml`, build logs, or the demo video.
5. Create the Blueprint and wait for the deploy to finish.
6. In the service dashboard, verify `APP_URL` equals the generated
   `RENDER_EXTERNAL_URL`. The app derives PayPal return/cancel URLs from this
   public origin unless explicit URLs are configured.
7. Verify `https://<your-render-host>/api/health` returns HTTP 200 with
   `{"status":"ok","database":"connected"}`.
8. Open the dashboard, create a merchant account, and verify that data remains
   after a service restart/redeploy.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite file on the persistent disk: `file:/var/data/agenttrust.db`. |
| `SESSION_SECRET` | Yes | Random secret for session signing/hashing; Render generates it in the Blueprint. |
| `APP_URL` | Yes in deployment | Public application origin. Blueprint self-references Render's `RENDER_EXTERNAL_URL`. |
| `PAYPAL_ENVIRONMENT` | Yes | Keep `SANDBOX`; do not switch to LIVE for the hackathon demo. |
| `PAYPAL_CLIENT_ID` | Yes for payments | PayPal Developer Dashboard sandbox REST app client ID. |
| `PAYPAL_CLIENT_SECRET` | Yes for payments | Matching sandbox REST app secret. Server-side only. |
| `PAYPAL_MERCHANT_ID` | Optional | Sandbox receiving merchant ID if the order should explicitly target a payee. |
| `PAYPAL_RETURN_URL` | Optional | Full public buyer-return URL; defaults to `APP_URL/api/paypal/return`. |
| `PAYPAL_CANCEL_URL` | Optional | Full public buyer-cancel URL; defaults to `APP_URL/api/paypal/cancel`. |
| `PAYPAL_WEBHOOK_URL` | For webhook testing | Public URL to register in PayPal: `APP_URL/api/paypal/webhook`. Documentation/configuration value; PayPal sends to the registered URL. |
| `PAYPAL_WEBHOOK_ID` | Yes for webhooks | Webhook ID returned by the PayPal sandbox app's webhook registration. |
| `OPENAI_API_KEY` | Optional | OpenAI API key for natural-language policy previews and advisory risk assessment. |
| `OPENAI_MODEL` | Optional | Defaults to `gpt-6-luna`. |

Never use the browser's PayPal client ID as a substitute for the server-side REST
client secret. Never expose either secret to client-side code.

## Configure PayPal sandbox

1. Sign in to the PayPal Developer Dashboard:
   https://developer.paypal.com/dashboard/
2. Select or create a sandbox business account and a sandbox personal (buyer)
   account. Keep them separate.
3. Under Apps & Credentials, create a REST app in the selected sandbox.
4. Copy that app's sandbox Client ID and Secret into the Render environment
   variables `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
5. Keep `PAYPAL_ENVIRONMENT=SANDBOX`.
6. Deploy/restart the service after saving the environment variables.
7. In the same REST app, add a webhook using the deployed URL:
   `https://<your-render-host>/api/paypal/webhook`.
8. Subscribe at minimum to:
   - `CHECKOUT.ORDER.APPROVED`
   - `CHECKOUT.PAYMENT-APPROVAL.REVERSED`
   - `PAYMENT.AUTHORIZATION.CREATED`
   - `PAYMENT.AUTHORIZATION.VOIDED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.PENDING`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`
9. Copy the webhook ID into `PAYPAL_WEBHOOK_ID` and redeploy.
10. Send a PayPal test webhook from the Developer Dashboard and confirm a verified
    event appears in the gateway audit/event history.

The PayPal webhook belongs to the specific REST app and environment. A sandbox
webhook ID is not a live webhook ID.

## Configure OpenAI

Create an API key in the OpenAI platform and set `OPENAI_API_KEY` in Render's
Environment settings. Keep `OPENAI_MODEL=gpt-6-luna` unless you have verified
another model supports the Responses API and Structured Outputs used by this code.
The key is used only by server-side AI policy preview and risk assessment routes.
The model receives no PayPal tools and cannot authorize, capture, void, or refund.

## Public URLs

After Render creates the service, copy its exact public URL from the Render
Dashboard. Do not guess the service name or hostname.

- App: `https://<your-render-host>/`
- Health: `https://<your-render-host>/api/health`
- PayPal buyer return: `https://<your-render-host>/api/paypal/return`
- PayPal buyer cancellation: `https://<your-render-host>/api/paypal/cancel`
- PayPal webhook: `https://<your-render-host>/api/paypal/webhook`

Set explicit `PAYPAL_RETURN_URL` and `PAYPAL_CANCEL_URL` only if the paths differ.
The application uses `APP_URL` (or Render's injected `RENDER_EXTERNAL_URL`) to
construct defaults. Register the webhook URL in the PayPal Developer Dashboard;
setting `PAYPAL_WEBHOOK_URL` alone does not register it.

## Deployment verification checklist

- [ ] Render deploy status is **Live** for the expected Git commit.
- [ ] Build log shows dependency installation, `prisma generate`, and Next build succeeded.
- [ ] `/api/health` returns HTTP 200 and confirms database connectivity.
- [ ] Restart the service and confirm merchant/agent/policy data persists.
- [ ] Merchant registration and login work over HTTPS.
- [ ] Agent registration returns a one-time secret; do not save it in logs.
- [ ] Unsigned checkout returns 403.
- [ ] Over-cap signed checkout returns BLOCK.
- [ ] Allowed signed checkout creates an actual sandbox PayPal order.
- [ ] Buyer approval returns to the configured public return URL and authorization is stored.
- [ ] Merchant explicitly issues capture approval and confirms capture.
- [ ] PayPal order, authorization, capture IDs and audit transitions are visible.
- [ ] A test webhook is cryptographically verified and duplicate delivery is idempotent.

No deployed URL, successful Render deploy, real PayPal transaction ID, or passing
production build is claimed by this configuration change.
