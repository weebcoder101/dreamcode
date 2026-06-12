---
name: frontend
description: "Frontend development standards for React, TailwindCSS, and Vite. Use for UI components, pages, styling, and frontend architecture. Covers component patterns, state management, and performance."
chains_with:
  - quality
  - lint-fixer
---

# Frontend Skill — Clean Components, Fast UI

## Component Architecture

### Patterns

| Pattern | Use When | Example |
|---------|----------|---------|
| Presentation | Just rendering data | KPICard |
| Container | Logic + data fetching | KPISection |
| Composition | Complex layouts | Dashboard |
| Higher-order | Cross-cutting behavior | ErrorBoundary |
| Custom hook | Shared state logic | useApiData |

### Rules
- One component = one file
- Component file ≤ 200 lines. Split if longer.
- Props typed (PropTypes or TypeScript)
- Default props for optional values
- No business logic in presentation components
- Side effects only in hooks or event handlers

## State Management

### Data Flow

```
API → useApiData hook → Container component → Presentation component
```

- Server state: use custom hooks (useApiData already exists)
- UI state: useState (local)
- Theme state: Context (ThemeContext)
- Pipeline events: CustomEvent (pipeline-complete)

### The useApiData Hook (Project-Q)
Auto-fetches on mount, auto-refetches on pipeline events:
```javascript
const { data, loading, error } = useApiData(projectQApi.getKPIs)
```

## Styling (TailwindCSS)

### Conventions
- Use existing theme tokens: `bg-slate-900`, `text-slate-400`, `border-slate-800`
- Dark mode: `dark:` prefix
- Responsive: `md:`, `lg:`, `xl:` prefixes
- Animations: `transition-all duration-300`
- Cards: `rounded-2xl border border-slate-800 p-6`

### Component Shell Pattern
```jsx
<ChartShell title="..." subtitle="..." minHeight={340}>
  {/* Chart content */}
</ChartShell>
```

## Performance

### React Optimization
- `React.memo()` for pure components
- `useMemo()` for expensive computations
- `useCallback()` for stable function references
- Lazy load heavy pages/charts
- Virtualize long lists

### Bundle Size
- Import only what you need: `import { BarChart } from 'recharts'`
- No `*` imports from libraries
- Code-split by route

## Accessibility
- Alt text on all images
- ARIA labels on interactive elements
- Keyboard navigation supported
- Color contrast WCAG AA minimum
- Focus indicators visible

## Page Structure (Project-Q)
```
CoreAnalytics.jsx — KPI cards, correlation, volatility
RiskEngine.jsx — VaR/ES, backtesting, breaches
SimulationLab.jsx — MC engine, quantum POC
Dashboard.jsx — Deprecated overview
```
