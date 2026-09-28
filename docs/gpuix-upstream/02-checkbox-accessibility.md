# Checkbox accessibility mapping

Suggested PR title: **Map aria-checked to native checked and mixed states**.

## Problem and change

Checkbox controls need their state exposed to accessibility clients, not only
painted visually. The local patch maps `aria-checked` into GPUI's
`aria_toggled` state in `packages/native/src/accessibility.rs`.

Source: [checkbox-a11y.patch](../../apps/gpuix/native/checkbox-a11y.patch).
The [published-package bridge patch](../../patches/@gpuix%2Fnative@0.10.0.patch)
also adds `aria-checked?: boolean | "mixed"` to the host contract and forwarding.
Port those changes into upstream source, not only generated declarations.

## Verification to port

Use [checkbox component coverage](../../packages/gpuix-ui/tests/checkbox/checkbox.component.test.tsx)
as a reference. Assert native accessibility-tree state for checked, unchecked,
and mixed controls, plus a control without `aria-checked`. Preserve existing
role, label, disabled, focus, and activation behavior.

This is separate from 1git's checkbox label composition and visual spacing;
those application/component choices do not belong in this native mapping PR.
Manual assistive-technology behavior should be checked on the target platforms;
native tree assertions alone are not a screen-reader usability test.
