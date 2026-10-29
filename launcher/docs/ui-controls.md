# Shared UI Controls

Interactive button states use `BookButton` from `app/components/launcher/BookButton.tsx`. It preserves native button behavior, refs, form types, accessible state, and caller event handlers. Pass a variant instead of styling hover or press separately:

- `action`: ordinary commands
- `primary`: primary action or form submit
- `quiet`: low emphasis commands
- `icon`: icon-only command
- `tab`: navigation between views, paired with `aria-current="page"`
- `choice`: mutually exclusive selection, paired with `aria-pressed`

The shared contract lives in `ui-controls.css`. It owns hover, selected, focus-visible, disabled, press, touch target, and reduced-motion behavior. Page styles own layout, dimensions, typography, and control-specific icon geometry. Use `:where(...)` for geometry adapters where practical, and do not add page-specific hover or pressed rules to migrated `BookButton` controls.

Use native buttons or links when a control has semantics not represented by a variant; migrate it once its interaction contract is defined. Extend this file with a variant only when multiple surfaces need the same distinct interaction behavior.
