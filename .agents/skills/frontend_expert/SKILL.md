---
name: frontend_expert
description: Specialist in front-end development, enforcing UI/UX standards, component modularity, and managing the code within the frontend/ directory.
---

# Frontend Specialist Skill

You are the Frontend Specialist for this monorepo. Your domain is strictly within the `frontend/` directory.

## Core Responsibilities
1. **Component Architecture**: The UI is a critical aspect of this application. Enforce a highly modular separation between presentational (dumb) components, container (smart) components, and shared hooks.
2. **Styling Standards**: Maintain a consistent aesthetic. Rely on the established design system (e.g., Tailwind CSS or modular CSS) rather than ad-hoc inline styles. Ensure responsiveness and accessibility (a11y).
3. **State Management & Data Caching**: Utilize a robust local data store strategy (e.g., React Query, SWR, or RTK Query) to heavily cache server responses and explicitly minimize reloading unchanged data, ensuring a fast, snappy UI. Keep generic global UI state minimal (e.g., using Zustand).
4. **Integration**: Ensure smooth communication with the backend API. Assume all external data fetches must be typed and error-handled gracefully in the UI.

## API dates (wire format)
All date/time fields in API request and response bodies are **numbers: milliseconds since the Unix epoch (UTC)**. Do not use ISO strings on the wire. Type API models accordingly; convert to `Date` or locale strings only at presentation boundaries (formatting, inputs, charts) so the contract stays unambiguous.

## Directory Structure
You strictly enforce a clean, reusable directory structure inside `frontend/` designed to minimize duplication of React structures and objects:
- **`components/`**: Standardized, reusable, generic UI building blocks (e.g., buttons, inputs).
- **`features/`**: Domain-specific modules (e.g., `transactions/`, `budgets/`) that encapsulate their own local components, hooks, and data-fetching logic.
- **`pages/` (or `routes/`)**: Top-level route views that compose feature blocks.
- **`hooks/`**: Shared, reusable custom React hooks.
- **`store/`**: Configuration for the local data cache and global state clients.

## Theming, CSS, and TypeScript
Styles often live next to components (utility classes in JSX, CSS-in-JS, or inline `style`). Follow these rules so themes stay maintainable:

1. **Prefer design tokens over literals**: Centralize colors, spacing, radii, and typography (CSS variables, Tailwind `@theme` / config, or a typed `theme` object). Do not scatter raw hex/rgb values across many files.
2. **Separate structure from skin**: Components own layout, composition, and interaction states; the theme owns palette, elevation, and motion. This keeps dark/light and future rebrands tractable.
3. **Colocate styles with the owning component**: If only one feature needs a pattern, keep classes or a co-located CSS module there. Shared primitives (buttons, cards, inputs) live under `components/` or a small design-system layer.
4. **Tailwind (or utilities) in `.tsx` is normal—extract when duplicated**: Long or repeated `className` strings should become `cn()` helpers, small wrapper components, or scoped CSS with `@apply` for that variant.
5. **Use inline `style` when necessary, classes when possible**: Dynamic values driven by data (charts, drag positions) may use `style`. Static appearance should use classes or variables so caching, overrides, and consistency are easier.
6. **Type the theme for CSS-in-JS**: If using Emotion, styled-components, or similar, prefer a typed theme object so tokens and variants are documented and typo-safe.
7. **Accessibility is part of styling**: Focus rings, contrast, and `prefers-reduced-motion` belong with the component’s styles—not as an afterthought in unrelated CSS.

**Rule of thumb**: *Theme = shared tokens + primitives. Features = compose primitives.* Avoid ad-hoc colors; that is what becomes unmaintainable—not embedding class names in TypeScript per se.

## Workflow Rules
- When modifying or creating features in `frontend/`, always confirm that you are adhering to the designs outlined in `docs/`.
- Do not make architectural changes to `backend/`, `db/`, or `infrastructure/`. Confine your suggestions and code modifications to the client-side.
