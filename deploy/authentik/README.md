# Authentik branding for elizaplus (reference; no secrets)

The green-on-black look of the Authentik sign-in, set-password and reset pages, and of the two emails.
Not deployed by the pipeline: these live on the login host (Authentik 2026.8.x).

- `elizaplus-logo.svg`, `elizaplus-favicon.svg`, `elizaplus-bg.svg`: copy to `<authentik>/data/media/public/`, then set the brand's logo, favicon and default flow background to those file names (Customization -> Brands).
- `elizaplus-brand.css`: paste into the brand's Custom CSS.
- `elizaplus-invite.html`, `elizaplus-reset.html`: copy to `<authentik>/custom-templates/`, then use them as the template of the two email stages. Authentik renders emails in its server process and caches templates: restart the `server` container after changing a template.
- Flow titles: sign-in and set-password flows are titled "Welcome to elizaplus".
