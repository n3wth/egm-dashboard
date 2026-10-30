# Boing public site

`index.html`, `product.html`, `features.html`, `terms.html`, and `privacy.html`
form the public site. The product and feature pages describe planned beta
capabilities; the legal pages state that the notices are being prepared. Login
remains disabled until the app is ready.

The `legal/` directory contains incomplete working drafts, not public notices. Exclude it from deployed static assets until the operator, jurisdiction, data practices, providers, contact channel, and legal review are complete. No contact address or public intake form has been configured; add a verified contact route before launch.

The landing page uses local JavaScript and a vendored GSAP asset for motion.
Validate links, responsive layout, contrast, keyboard navigation, and
reduced-motion behavior before deployment.
