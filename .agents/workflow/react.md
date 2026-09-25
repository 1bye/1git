# React defaults

Use alongside the TypeScript baseline for React work. Follow the application's
rendering model, component library, styling system, and more specific instructions.
React components and hooks remain functions; substantive domain behavior follows
the stateless-OOP baseline.

## UI ownership

For new UI boundaries, use these meanings:

| Directory | Owns | Example |
| --- | --- | --- |
| `ui/` | Reusable primitives with little domain knowledge | Button, input, dialog |
| `fixture/` | Complete composed UI with little or no domain state | Application header, static toolbar layout |
| `feature/` | Substantial feature state, workflows, hooks, or model behavior | Checkout, editor timeline, search workflow |

Keep feature-specific components with their feature. Preserve equivalent existing
directory names rather than renaming a repository during a focused change.
`fixture/` here means UI composition; keep test fixtures with the tests they serve.
Create only directories and files the feature needs.

## Components and files

- Prefer one main cohesive component per TSX file, or a few small components that
  share a topic. A large cohesive component is acceptable; do not split by line
  count or merely because a JSX fragment can be named.
- Extract a component when it has independent behavior, state, reuse, or a clear
  responsibility. Keep trivial single-use markup with its owner.
- Use function components, preferably named declarations for exported components
  when the project has no stronger style. Define components outside other
  components so their identity remains stable.
- Keep small props types local. Name reusable or substantial contracts and use
  the project's declaration and return-type style.
- Add client boundaries only where the framework requires them. Keep
  server-only dependencies out of client code.
- Keep domain decisions outside presentation. Components own presentation
  behavior such as visibility, focus, selection, and interaction.

## State, hooks, and effects

- Call hooks at the top level. Keep state with its narrowest practical owner;
  lift it when multiple consumers actually need a shared source of truth.
- Compute cheap derived values during rendering. Do not synchronize duplicate
  state with effects when the value already follows from props or state.
- Effects synchronize with external systems. Declare the dependencies they use
  and clean up subscriptions, resources, and stale asynchronous work. Do not
  suppress dependency warnings to force an execution schedule.
- Extract hooks for cohesive reusable behavior or a meaningful lifecycle, not
  just to move lines out of a component.
- Use context for values shared across a meaningful subtree. Use external stores
  when ownership, subscriptions, or lifetime justify them. Keep domain rules
  with their domain owner.
- Add memoization for a concrete identity requirement or computation cost.
  Do not wrap every value or handler by default.

## Styling and component libraries

- Reuse existing UI primitives and variants. Check the project's actual component
  API and Base UI/Radix choice before composing triggers, overlays, or forms.
- For Tailwind, use the project's single established `cn` import for conditional
  class composition. Do not create competing helpers during feature work.
- Prefer established tokens and variants. Preserve custom class-merging rules
  only where their corresponding tokens exist. Use inline styles for genuinely
  dynamic values where they are clearer.
- Follow configured formatting, class sorting, and lint rules. Adding a shared
  `cn` package or a new lint integration is a deliberate tooling change.
- For Tailwind v4 projects adopting design-system linting, use the optional
  [combined Oxlint config](configs/README.md#oxlint-spacing-and-shadcn). Keep component
  discovery, theme paths, and overrides aligned with the actual project. Preserve
  the established `cn` helper; adopting lint rules does not require replacing it.

## Interaction and verification

- Prefer native semantic controls. Provide accessible names, form labels,
  keyboard interaction, visible focus, and relevant disabled/expanded/error states.
- Preserve focus when opening and closing overlays; use the component library's
  behavior rather than reimplementing it without a reason.
- Handle loading, empty, error, disabled, and success states where relevant.
  Give informative images meaningful alternative text and decorative images
  empty alternative text.
- Test what people can see and operate, important state transitions, and interaction
  regressions. Avoid assertions about incidental class order or private hook calls.
- For visible or interactive changes, inspect the affected UI and exercise its
  relevant behavior when possible. Type checking alone does not verify layout,
  keyboard behavior, or focus. State any verification limits explicitly.
