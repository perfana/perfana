# Perfana Design System

A comprehensive design system for the Perfana performance analysis platform, built with enterprise-grade aesthetics and performance monitoring in mind.

## Overview

The Perfana Design System provides a cohesive visual language and component library that emphasizes:
- **Performance-first**: Optimized for displaying performance metrics and analytics
- **Enterprise-grade**: Professional aesthetics suitable for business environments
- **Accessibility**: WCAG-compliant components and color schemes
- **Modern Architecture**: Built with CSS custom properties and modern web standards

## Architecture

### Design Tokens (`tokens.css`)
Centralized design values including:
- **Colors**: Brand palette, semantic colors, and performance-specific colors
- **Typography**: Font stacks, sizing, weights, and spacing
- **Layout**: Spacing scale, border radius, shadows, and z-index
- **Animation**: Timing functions and transition presets

### Base Styles (`base.css`)
- CSS reset and normalization
- Base typography and element styling
- Focus management and accessibility features
- Print styles and responsive optimizations

### Components (`components.css`)
Pre-built component styles including:
- Buttons (primary, secondary, ghost variants)
- Cards with hover effects
- Form inputs and controls
- Badges and status indicators
- Alerts and notifications
- Loading states and progress indicators
- Performance metric cards

### Layout (`layout.css`)
Layout primitives and patterns:
- Grid and flexbox systems
- Container and spacing utilities
- App shell and sidebar layouts
- Navigation patterns
- Responsive breakpoints

### Utilities (`utilities.css`)
Low-level utility classes for:
- Spacing (margin, padding)
- Typography (font sizes, weights, alignment)
- Colors (text, background, borders)
- Layout (display, position, sizing)
- Interactive states (hover, focus, active)

## Usage

### CSS Import
```css
/* Import the complete design system */
@import '../styles/perfana-design-system.css';
```

### TypeScript Components
```tsx
import { Button, Card, MetricCard, StatusBadge } from '@/components/ui'

// Basic button
<Button variant="primary" size="lg">
  Run Performance Test
</Button>

// Performance metric display
<MetricCard
  value="1.2s"
  label="Response Time"
  change={{
    value: "0.1s",
    direction: "negative"
  }}
/>

// Status indicator
<StatusBadge status="excellent">
  Performance Excellent
</StatusBadge>
```

## Component API

### Button
- **Variants**: `primary`, `secondary`, `ghost`, `success`, `warning`, `error`
- **Sizes**: `xs`, `sm`, `base`, `lg`, `xl`
- **States**: `isLoading`, `disabled`
- **Icons**: `leftIcon`, `rightIcon` support

### Card
- **Variants**: `default`, `bordered`, `elevated`, `flush`
- **Structure**: `Card`, `CardHeader`, `CardTitle`, `CardSubtitle`, `CardContent`, `CardFooter`

### Input
- **Variants**: `default`, `error`, `success`
- **Sizes**: `sm`, `base`, `lg`
- **Icons**: `leftIcon`, `rightIcon` support

### Badge & StatusBadge
- **Variants**: `primary`, `success`, `warning`, `error`, `gray`
- **Performance variants**: `performance-excellent`, `performance-good`, `performance-fair`, `performance-poor`, `performance-critical`
- **Sizes**: `sm`, `base`, `lg`

### MetricCard
Specialized component for displaying performance metrics with:
- Value and label display
- Change indicators (positive/negative/neutral)
- Icon support
- Responsive design

## Color System

### Brand Colors
- Primary blue palette for actions and focus states
- Performance status colors (green to red spectrum)
- Semantic colors for success, warning, error states

### Performance Visualization
- **CPU**: Red (`#ef4444`)
- **Memory**: Amber (`#f59e0b`)  
- **Network**: Cyan (`#06b6d4`)
- **Disk**: Purple (`#8b5cf6`)
- **Response Time**: Emerald (`#10b981`)
- **Throughput**: Blue (`#3b82f6`)
- **Error Rate**: Red (`#dc2626`)

## Typography

### Font Stack
- **Primary**: Inter (clean, readable sans-serif)
- **Monospace**: JetBrains Mono (for code and metrics)

### Scale
- **Display**: 72px, 60px, 48px, 36px, 30px
- **Body**: 20px, 18px, 16px, 14px, 12px
- **Weights**: 300, 400, 500, 600, 700, 800

## Dark Mode

The design system includes full dark mode support via the `[data-theme="dark"]` selector. Colors automatically adapt while maintaining contrast ratios and readability.

## Responsive Design

- **Mobile-first**: Base styles target mobile devices
- **Breakpoints**: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)
- **Adaptive layouts**: Sidebar collapses, grid systems stack appropriately

## Performance Considerations

- **CSS Custom Properties**: Efficient runtime theming
- **Tree-shakable**: Import only needed components
- **Optimized animations**: Respects `prefers-reduced-motion`
- **Minimal bundle size**: Selective imports and efficient CSS

## Accessibility

- **Color contrast**: WCAG AA compliance
- **Focus management**: Visible focus indicators
- **Screen reader**: Semantic markup and ARIA attributes
- **Keyboard navigation**: Full keyboard support
- **High contrast mode**: Adapts to user preferences

## Browser Support

- **Modern browsers**: Chrome 88+, Firefox 78+, Safari 14+, Edge 88+
- **CSS Features**: Custom properties, Grid, Flexbox
- **Graceful degradation**: Fallbacks for older browsers

## Contributing

When adding new components or modifying existing ones:

1. Follow the established naming conventions
2. Use design tokens for all values
3. Ensure accessibility compliance
4. Add TypeScript types for React components
5. Test across supported browsers and screen sizes
6. Document component APIs and usage examples

## Examples

### Dashboard Layout
```tsx
<div className="app-shell">
  <aside className="sidebar">
    <div className="sidebar-header">
      <h1>Perfana</h1>
    </div>
    <nav className="sidebar-content">
      {/* Navigation items */}
    </nav>
  </aside>
  <main className="main-content">
    <header className="topbar">
      {/* Header content */}
    </header>
    <div className="content-area">
      <div className="page-header">
        <h1 className="page-title">Performance Dashboard</h1>
        <p className="page-description">Monitor your application performance</p>
      </div>
      <div className="stats-grid">
        <MetricCard value="1.2s" label="Avg Response Time" />
        <MetricCard value="99.9%" label="Uptime" />
        <MetricCard value="1.2M" label="Requests/day" />
      </div>
    </div>
  </main>
</div>
```

### Form Example
```tsx
<Card>
  <CardHeader>
    <CardTitle>Test Configuration</CardTitle>
    <CardSubtitle>Configure your performance test</CardSubtitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <Input 
      placeholder="Test name"
      variant="default"
    />
    <Input 
      placeholder="Target URL"
      leftIcon={<LinkIcon />}
    />
    <div className="flex gap-3">
      <Button variant="primary">
        Start Test
      </Button>
      <Button variant="secondary">
        Save Draft
      </Button>
    </div>
  </CardContent>
</Card>
```