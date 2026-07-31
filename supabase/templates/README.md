# Supabase Email Templates

## Live Project Status

Activated on 2026-07-14 after configuring custom SMTP through Resend.

- Sending domain: `auth.seaweed-harvest.com`
- Sender: `Seaweed Harvest <no-reply@auth.seaweed-harvest.com>`
- Invite subject: `You're invited to Seaweed Harvest`
- Invite body: `invite.html`
- Confirmation subject: `Confirm your Seaweed Harvest account`
- Confirmation body: `confirmation.html`
- Password reset subject: `Reset your Seaweed Harvest password`
- Password reset body: `recovery.html`

Supabase Auth sends the branded authentication templates through the verified Resend domain.

All three templates use the current transparent Seaweed Harvest wordmark from
`https://seaweed-harvest.com/assets/images/seaweed-harvest-logo.png` and the
footer `by Cascadia Nature-based Solutions.`

## Reapply Invite User Template

The templates are managed by `supabase/config.toml`. Run `supabase config push`
only after reviewing its remote/local diff. Confirm that no unrelated Auth
settings will change, then send test invitation, confirmation and password
recovery messages and verify their redirects.

The template uses `{{ .ConfirmationURL }}`, which preserves the existing invitation and password setup flow.

## Branded Sender

The visible sender is configured in **Authentication > Custom SMTP** with:

- Sender name: `Seaweed Harvest`
- Sender address: `no-reply@auth.seaweed-harvest.com`

Resend manages the verified SPF and DKIM records for the dedicated sending domain through Cloudflare DNS.

Required activation details:

- SMTP host and port;
- SMTP username and password or provider credential;
- verified sender address;
- sender name `Seaweed Harvest`;
- one test recipient.

Enter SMTP credentials directly in Supabase. Do not commit them or paste them into planning documents.
