# Generic Code Rules

These are fallback rules for production code. They are meant to guide judgment, not
to impose one architecture on every repository.

Interpret **MUST**, **SHOULD**, and **MAY** as requirement levels:

- **MUST**: required unless the task explicitly says otherwise.
- **SHOULD**: the default; deviate when local evidence gives a better answer.
- **MAY**: optional and context-dependent.

## 0. Precedence and working method

Use this order of precedence:

1. The explicit task and acceptance criteria.
2. The nearest project instructions.
3. The current architecture and the nearest comparable production code.
4. These generic rules.

Existing code is evidence, not automatically a pattern. Prefer current, intentional
code over generated code, compatibility layers, migrations, and obvious legacy
exceptions.

Before choosing an abstraction or a name:

1. Inspect the nearest owner, its callers, tests, exports, and documentation.
2. Identify the project's established vocabulary and directory boundaries.
3. Decide which existing module or object should own the behavior.
4. Make the smallest coherent change that satisfies the task.

Do not redesign unrelated code or normalize a repository to this document.

The north star is:

- Correct behavior and explicit invariants.
- A small number of meaningful concepts.
- Code placed with the thing that owns it.
- Names that are precise in their actual context.
- Straightforward control flow and data flow.
- No speculative abstraction or flexibility.

Production work MUST be complete. Do not leave placeholders, empty implementations,
or deferred core behavior unless the task explicitly asks for scaffolding.

## 1. Documentation and comments

Documentation exists to preserve a contract or non-obvious decision, not to satisfy
a quota.

Document:

- Stable public package APIs.
- Invariants, ownership rules, units, and lifecycle requirements.
- Security-sensitive behavior and trust boundaries.
- Failure modes that callers must handle.
- Surprising behavior or decisions whose reason is not visible in the code.

Self-evident internal exports do not need ceremonial JSDoc. If the local project
documents every exported symbol, follow that stronger convention.

Comments SHOULD explain **why**, constraints, or externally meaningful behavior.
Do not restate syntax or narrate each line.

Long workflows MAY start with a short phase summary when it materially improves
navigation. Keep the implementation itself readable enough that comments are not
required to reconstruct the control flow.

## 2. Choose the smallest fitting construct

Start with the simplest construct that represents the required ownership.

| Need | First choice | Escalate when |
| --- | --- | --- |
| Stateless calculation, parsing, formatting, or transformation | Function | A cohesive family has an established project abstraction |
| Behavior belonging to an existing object or module | Existing method or local/private helper | It has a different owner or reason to change |
| State, identity, lifecycle, or enforced invariants | Class | A plain value plus functions cannot represent the contract clearly |
| Several related pure operations | Cohesive module of functions | Local convention deliberately uses a helper namespace/class |
| Replaceable implementation | Concrete implementation | There are real alternatives or an external boundary |
| Construction with policy or branching | Factory function or class | Construction has meaningful state or an established factory contract |
| Keyed registration, lookup, or shared identity | Map/object owned by the caller | Runtime discovery or registry semantics are part of the design |
| Multi-step use case | Function or existing domain owner | The workflow owns state, lifecycle, or a stable public contract |

Do not create a class merely to give one function a role-shaped name.

Before introducing a new class, interface, factory, registry, coordinator, or
processor, identify the concrete requirement that the abstraction represents. If
the requirement cannot be named without referring to future possibilities, keep
the design concrete.

### 2.1 Functions and local logic

Use a function when the behavior:

- Is stateless.
- Has explicit inputs and outputs.
- Does not own identity or lifecycle.
- Does not need to enforce an invariant across multiple operations.

Keep one-off logic in the current function or as a local/private helper when that is
where it is understood and owned. Extraction is not an improvement by itself.

Use the repository's established function declaration style. Arrow functions and
function declarations are syntax choices, not architectural boundaries.

An options object is useful when arguments are optional, easy to confuse, or
expected to evolve independently. Do not create `Options`, `Params`, or `Config`
types as ceremony around one or two clear arguments.

Avoid positional boolean arguments. Prefer a named option or a domain-specific
operation.

### 2.2 Classes

Use a class when it owns at least one substantive concern:

- Mutable state or identity.
- A lifecycle.
- Dependencies used across multiple operations.
- Invariants enforced across operations.
- A cohesive domain or infrastructure contract already expressed as a class in the
  project.

A class with one public method can be valid when an interface, state, lifecycle, or
established architectural role requires it. Otherwise, a one-method stateless class
SHOULD become:

- A function in the owning module.
- A private method on the existing owner.
- An additional operation on an existing cohesive abstraction.

Do not split a class by line count. Several closely related methods are preferable
to a group of tiny role classes that only pass data to one another.

Do not merge unrelated responsibilities merely to avoid a new class. Ownership and
reasons to change matter more than the number of files.

### 2.3 Interfaces, factories, registries, and helpers

Interfaces SHOULD represent a real substitution point, public boundary, or testable
external dependency. Do not pair every class with an interface by default.

A factory earns its name when construction includes meaningful policy, validation,
selection, dependency assembly, caching, or lifecycle control. A wrapper whose only
job is `return new Thing(...)` SHOULD be a direct constructor call or a plainly
named function.

A registry earns its name when keyed registration, runtime discovery, replacement,
or shared instance identity is part of the contract. Do not add a registry merely
to avoid explicit imports or to centralize unrelated constructors.

`Helper` is allowed when it has a constrained, recognizable role such as pure local
calculation, normalization, or comparison. It is not a dumping ground for unrelated
behavior.

- Prefer a named function for one helper operation.
- A cohesive module of helper functions is usually enough.
- A small static helper class is acceptable when it matches a deliberate local
  convention and groups several operations over the same concept.
- Helpers SHOULD NOT own network I/O, persistence, workflow orchestration, or hidden
  mutable state.

### 2.4 Composition and dependency ownership

Build dependency graphs at an explicit application, package, or feature composition
root.

- Choose eager or lazy construction from actual lifetime and cost requirements.
- Preserve shared instance identity only where the contract requires it.
- Leaf modules SHOULD NOT silently construct a second dependency graph.
- Default collaborators are acceptable only when they are intentional API behavior,
  not a way to hide wiring.
- Dependency injection is a tool, not a requirement for every object.

A single module registry can be the correct composition mechanism when consumers
need stable shared module identity. This does not make registries a default for
ordinary construction.

### 2.5 When to extract

A new abstraction, file, or directory SHOULD earn its existence through at least
one of these:

- It has a distinct owner or lifecycle.
- It protects a meaningful invariant.
- It is reused by more than one real consumer.
- It forms an external or public boundary.
- It changes for a different reason than its current owner.
- It contains enough cohesive behavior to be understood independently.

Do not extract solely because code is a few lines long, a name can be invented for
it, or a hypothetical caller might need it later.

## 3. Naming and project vocabulary

Names are interpreted together with their package, directory, file, type, and call
site. Use the shortest name that is unambiguous at its real boundary, not the
shortest name in isolation and not a description of the entire implementation.

### 3.1 Use a controlled local vocabulary

First discover the architectural terms already defined by the project. Reuse a role
suffix only when it preserves that established meaning.

| Term | Good meaning | Warning sign |
| --- | --- | --- |
| `Sdk` | Public API namespace for a provider or resource | Internal utility with no SDK boundary |
| `ForeignSdk` | Project-defined cross-resource SDK composition | A generic synonym for adapter |
| `Service` | An actual domain resource/capability, or a defined service-layer role | Vague bucket for miscellaneous business logic |
| `Helper` | Cohesive pure/local operations over one concept | I/O, orchestration, or unrelated utilities |
| `Mapper` | Translation between named representations | General mutation or validation |
| `Repository` | Persistence access for an owned domain collection | Any class that reads data |
| `Client` | Protocol or external API access | Domain orchestration |
| `Adapter` | Translation at an external contract boundary | Extra wrapper around an identical interface |
| `Factory` | Construction policy or selection | A one-line alias for a constructor |
| `Registry` | Keyed discovery, registration, or shared identity | A global container of unrelated instances |
| `Handler` | Framework, command, event, or request entry point | Any function that handles something |
| `Coordinator`, `Processor`, `Manager` | A specifically defined orchestration role | A substitute for identifying the owned use case |

Do not reject `Service` or `Helper` by suffix alone. Determine whether the name
describes a stable project concept with a constrained responsibility.

If two suffixes could be swapped without changing anyone's understanding, the role
is not defined precisely enough.

### 3.2 Let context carry context

A stable namespace may carry provider, domain, or layer information:

- Inside a provider-specific package, repeat the provider name only when crossing a
  public boundary or resolving an actual ambiguity.
- Inside `orders/`, prefer `Repository` or `OrderRepository` according to the local
  export style; do not automatically encode the whole path in every symbol.
- At a cross-package boundary, include the qualifier a caller needs to distinguish
  the concept.

There is no universal maximum name length. A long name is acceptable when every
word distinguishes a real domain or architectural axis. A long sequence of
mechanism, domain, and role words is also a signal to re-check placement and
ownership.

Repeated aliases with different prefixes are a review signal. They can be valid at
public package boundaries, but SHOULD NOT be copied mechanically into internal
code.

### 3.3 Name facts and domain operations

- Use nouns for values, types, and objects.
- Use verbs for functions and operations.
- Use predicates such as `is`, `has`, `can`, or `should` for booleans.
- Name a condition after the fact it detects, not the control-flow consequence.
  Prefer `isNoDataError` over `shouldReturnUndefined`.
- Use one verb consistently for one operation. Do not alternate between `load`,
  `fetch`, `read`, and `get` unless their semantics differ.
- Avoid repeating the enclosing type in every method name when the receiver already
  supplies that context.
- Follow local acronym and casing conventions.

Do not add prefixes such as `I`, `Abstract`, `Base`, `Impl`, or `Default` unless they
communicate a real distinction and match project vocabulary.

### 3.4 Examples of the decision

- `ServicesSdk` is good when **Services** is the provider's actual resource and
  `Sdk` identifies the package's public resource API.
- `ProductHelper` is reasonable for a cohesive family of pure product calculations.
  With one stateless operation, prefer a function such as `calculateProductTotal`.
- `SalesDocumentLinesForeignSdk` can be good in an SDK architecture where each token
  identifies a real resource and cross-resource role. It is not a generic naming
  pattern to reproduce elsewhere.
- `DefaultsFactory.create()` with no policy is usually `createDefaults()` or a
  literal owned by the caller.
- `MerchantCopyReader.read()` with no state or interface is usually
  `readMerchantCopy()` or a method on the existing merchant owner.
- Before adding `LineItemInvoiceJobCoordinator`, check whether an invoice-job
  workflow folder and a domain operation can carry most of that context.
- A legacy `AgentToolRegistry` may remain as an explicit compatibility boundary.
  Its existence is not evidence that new tools need registry wrappers.

## 4. Ownership, files, and folders

Place code with the concept that owns its invariants and changes, then express its
technical role inside that boundary.

| Concern | Likely owner |
| --- | --- |
| One domain resource | That resource or domain directory |
| A use case spanning resources | A named workflow, use-case, or orchestration boundary |
| External provider/protocol behavior | The provider integration or adapter |
| Pure calculation for one concept | The concept's module or constrained helper |
| Persistence | The owning domain's repository |
| Dependency graph construction | A composition root |
| Truly cross-domain reusable behavior | A deliberately scoped shared package |

Directory names vary by project. `core/<resource>`, `foreign/<edge>`,
`integrations/<provider>`, and `workflows/<use-case>` are examples of ownership
boundaries, not mandatory names.

### 4.1 Structure by owner before role

Prefer:

```text
orders/
  order.ts
  repository.ts
  mapper.ts
  helper.ts
```

over a repository-wide collection of unrelated `services/`, `helpers/`,
`repositories/`, or `managers/`, unless the project intentionally defines a
role-first architecture.

Use one clear organizing axis per directory level. Avoid mixing provider, domain,
layer, and operation names at the same level without an explicit architecture.

Keep types near their owner. Do not create a generic `types.ts` or `core/types.ts`
grab bag for unrelated concepts. A type-only module is appropriate when the types
form a cohesive public contract or are shared by several files in the same owned
boundary.

Multiple closely related exports MAY live in one file. One primary export per file
is not a goal. Split when ownership, navigability, independent reuse, or reasons to
change justify it.

Do not create:

- Empty structural directories.
- Files that only forward one internal symbol without a compatibility reason.
- `common`, `shared`, `utils`, or `misc` modules with no defined ownership boundary.
- A separate constants, options, result, or error file for every small feature.

Keep a utility local until it has a second real owner. When promoting it, name the
new shared boundary after what the utility does or the concept it serves.

### 4.2 Compatibility and generated code

Compatibility shims MUST be explicit, narrow, and labeled as compatibility or
legacy surfaces. Do not mirror an entire package tree with forwarding modules.

Generated code MUST stay in a clear generated boundary and MUST NOT be manually
edited unless the generator's workflow explicitly requires it.

### 4.3 Barrels and public surfaces

Follow the repository's import and barrel convention.

- Prefer explicit package or feature boundaries over deep public imports.
- Keep internal dependency direction visible.
- Do not add an `index.ts` to every directory by reflex.
- Avoid broad barrels that create cycles or expose implementation details.

### 4.4 Schemas and derived types

Keep a runtime schema near the boundary or concept it validates. Derive the static
type from the schema when the project tooling supports it; do not maintain duplicate
shapes by hand.

Validate untrusted data at its boundary. Internal values SHOULD remain typed rather
than repeatedly revalidated.

## 5. TypeScript and API design

Obey the repository's `tsconfig`, formatter, linter, module system, and import
conventions.

- Preserve strict typing.
- Prefer `unknown` to `any`, then narrow explicitly.
- Use `import type` when required by the module configuration.
- Prefer named exports for library code unless the framework or project requires a
  default export.
- Give stable public APIs explicit, useful types. Allow obvious local inference.
- Use discriminated unions for meaningful state variants.
- Handle indexed access and optional values deliberately.
- Prefer exhaustive handling when adding a new variant would otherwise fail
  silently.
- Do not use assertions to bypass missing validation or a broken model.

Keep signatures direct:

- Put stable required inputs first.
- Use an options object when it improves call-site clarity.
- Name units in values and types, such as `timeoutMs` or `sizeBytes`.
- Return a domain result rather than several loosely related out-parameters.
- Do not introduce generic type parameters that have only one meaningful type.

Use whitespace to separate logical phases, not mechanically before every `return`,
branch, or call. Let the formatter control surface style.

## 6. Constants and configuration

Keep a constant beside its owner until it is genuinely shared, large, generated, or
part of a public configuration contract.

- Name domain constants and units explicitly.
- Avoid unexplained numeric or string literals whose meaning is not obvious.
- Keep one-off regular expressions local; move reused or hot-path expressions to
  stable module scope.
- Do not create a global constants file containing unrelated values.
- Distinguish deploy-time configuration from ordinary domain defaults.

## 7. Data ownership and immutability

Do not mutate caller-owned input unless mutation is the explicit contract.

- Copy at an ownership boundary when the callee must retain or mutate data.
- Avoid defensive copies that provide no ownership benefit.
- Normalize once at an appropriate boundary instead of throughout the call graph.
- Use `Map` and `Set` when their key semantics or operations are useful; use plain
  records and arrays when they are clearer.
- Expose mutable collections deliberately. Return read-only views or copies when the
  owner must protect its invariants.

## 8. Errors and observability

Throw `Error` objects or project-specific error types, never bare strings.

Errors SHOULD:

- Identify the failed operation.
- Include safe, relevant context.
- Preserve the original cause when adding context.
- Use a stable type or code when callers are expected to branch on them.
- Avoid secrets, credentials, and unnecessary personal data.

Catch an error only to recover, translate it at a boundary, add useful context, or
perform required cleanup. Do not swallow errors or log and rethrow the same error at
every layer.

Log at the layer that owns the operation and has enough context to make the event
actionable. Do not ship stray `console.log`, debug output, or `debugger` statements.

## 9. Performance

Correctness and clarity come first. Optimize measured bottlenecks and obvious
algorithmic waste.

- Choose an appropriate algorithm and data structure before micro-optimizing.
- Avoid repeated parsing, allocation, or I/O in known hot paths.
- Prefer standard, well-tested primitives unless measurement justifies custom code.
- Do not add caching, memoization, pooling, or lazy initialization without a clear
  lifetime, invalidation, or cost reason.
- Document a non-obvious optimization and the invariant that makes it safe.

## 10. Testing

Use the repository's runner, location, naming, and fixture conventions.

Test:

- Observable behavior and owned invariants.
- Boundary values and meaningful edge cases.
- Failure behavior that callers rely on.
- Regression cases for fixed defects.
- Integration boundaries in proportion to their risk.

Keep test setup local until repetition makes a shared builder or fixture clearer.
Test helpers belong with the tests or domain they serve; do not build a general test
framework for one suite.

Mocks, fakes, and spies are appropriate at real boundaries. Avoid mocking internal
implementation details merely to assert the sequence of private calls.

Use comments in tests for non-obvious regression context, not to narrate
arrange/act/assert. Do not commit focused or skipped tests unless the suite
explicitly models them. Await asynchronous expectations and cleanup.

## 11. React and UI code

Follow the framework and component-library conventions already present in the
application.

- Use function components and call hooks only at the top level.
- Split components by responsibility, reuse, or independent state—not by line count
  or because a JSX fragment can be named.
- Keep trivial single-use markup with its owner.
- Use context for genuinely cross-cutting state, not to avoid passing a local prop
  through one layer.
- Add `useMemo`, `useCallback`, or component memoization only for a demonstrated
  identity or computation reason.
- Use semantic HTML, accessible names, keyboard behavior, and correct labels.
- Preserve the project's styling and class-merging conventions.
- Separate store interfaces, providers, selectors, and fixtures only when those are
  real boundaries in the local architecture.

Keep business rules with their domain owner rather than hiding them in presentation
components or generic UI utilities.

## 12. Completion checklist

Before finishing a change, verify:

### Fit

- Did I inspect the nearest comparable production code and its callers?
- Does the change follow the project's established vocabulary and boundaries?
- Did I avoid unrelated cleanup and architectural normalization?

### Abstractions

- Does every new class own state, lifecycle, invariants, dependencies, or an
  established cohesive contract?
- If a class has one stateless method, should it be a function, private method, or
  operation on an existing owner?
- Does every new interface, factory, registry, helper, coordinator, or processor
  represent a concrete requirement?
- Could the behavior live more clearly in an existing owner?
- Did I avoid extracting merely because the code is small or nameable?

### Names and placement

- Does every word in a long name distinguish something the caller needs?
- Can the package, folder, file, or receiver carry part of the context?
- Are role suffixes used with their defined local meaning?
- Are conditions named after facts rather than branch outcomes?
- Is the code placed by its owner before its technical role?
- Did I avoid vague `shared`, `common`, `utils`, or `types` buckets?
- Are compatibility and generated boundaries explicit?

### Correctness and quality

- Are inputs, outputs, ownership, units, and failure behavior clear?
- Are untrusted values validated at the boundary?
- Are errors precise, safe, and preserved where appropriate?
- Is the control flow direct, with no placeholder or dead path?
- Are performance mechanisms supported by a real cost or lifetime requirement?
- Do tests cover behavior, invariants, edges, and relevant failures?
- Is documentation focused on public contracts and non-obvious decisions?
- Do formatting, linting, type checking, and relevant tests pass?
