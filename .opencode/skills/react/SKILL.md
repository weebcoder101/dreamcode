---
name: react
description: "React development standards for hooks, components, state management, and performance. Use for all React/JSX code."
chains_with:
  - quality
  - lint-fixer
---

# React Skill — Hooks-First, Composable, Tested

## Component Architecture

### Functional Components Only
```jsx
// ✅ CORRECT
export default function KPISection() {
  const { data, loading, error } = useApiData(api.getKPIs)
  return <div>{/* render */}</div>
}

// ❌ NEVER — no class components
```

### Hooks Rules
- Only call hooks at the top level
- Only call hooks from React functions
- Custom hooks for reusable logic
- `useMemo`/`useCallback` for expensive operations

### Data Fetching Pattern (Project-Q)
```jsx
function useApiData(fetchFn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  useEffect(() => {
    const controller = new AbortController()
    fetchFn({ signal: controller.signal })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, deps)
  
  return { data, loading, error }
}
```

## Performance

### Memoization
```jsx
// Memoize expensive computations
const stats = useMemo(() => {
  return computeExpensiveStats(data)
}, [data])

// Memoize callbacks passed to children
const handleClick = useCallback(() => {
  doSomething(id)
}, [id])

// Memoize component to skip re-renders
export default React.memo(ExpensiveChart)
```

### Avoid
- Inline object/array props in JSX (`items={['a', 'b']}`)
- New function references in renders
- Unnecessary state (derive from props when possible)
- Large lists without virtualization

## Imports
```jsx
// Order: React → third-party → local
import { useState, useEffect } from 'react'
import { BarChart, Bar } from 'recharts'
import { useApiData } from '../hooks/useApiData'
import ChartShell from './ChartShell'
```

## Error Handling
```jsx
// Wrap every component
<ErrorBoundary>
  <KPISection />
</ErrorBoundary>
```
