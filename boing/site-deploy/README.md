# Public site deployment

This configuration publishes only the public static site to `boing.run`.
Run `node prepare-assets.mjs` to prepare the allowlisted files in `dist/`;
the unpublished legal drafts, tests and project files are excluded.
Use the pinned Cloudflare CLI and run `cf deploy --dry-run` before deployment.
The authenticated app and the legacy EGM deployment are separate.
