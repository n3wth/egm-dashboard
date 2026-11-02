# Dashboard UI conventions

Use the existing `Button`, `Dialog`, `DataComponent`, `DataTable`, and other primitives from `../../data-app-public.jsx`. Keep source actions, keyboard behavior, and reviewed data intact.

- Use foundation `--space-*` tokens for spacing and `--data-card-gap` between cards. Keep card padding and headings owned by `DataComponent`.
- Use `--text-xs-size` for metadata, `--egm-text-label` for compact labels, `--text-sm-size` for body and item headings, and `--text-xl-size` for page headings. The caption and metric steps live in `theme.css`; Ask aliases the same scale.
- Use existing theme foreground, surface, border, interaction, and radius tokens. Verify both light and dark appearances.
- Add `egm-field` to authored text inputs and textareas. Use `egm-field--compact` in card toolbars, `egm-icon-button` on icon-only shared Buttons, and `egm-form-dialog` on form Dialogs. `components.css` owns their geometry and focus/disabled states, including 44px mobile targets and 16px mobile fields.
- Keep component-specific CSS for layout only where a shared rule already covers appearance. Preserve explicit dimensions for charts, thumbnails, and numeric columns.

Validate with `npm test` and `npm run build` from the repository root, then inspect affected controls and pages at desktop and mobile widths.
