# Next.js & Claude Code: Best-in-Class Coding Rules

## 🎯 Core Principles

```yaml
core_principles:
  type_safety_first: "Always use TypeScript with strict mode enabled"
  performance_by_default: "Optimize for Core Web Vitals from the start"
  accessibility_always: "WCAG 2.1 AA compliance minimum"
  security_conscious: "Follow OWASP guidelines"
  test_coverage: "Maintain minimum 80% test coverage"
```

## 📁 Project Structure

```yaml
project_structure:
  src:
    app: "Next.js 13+ App Router"
    routes:
      auth: "(auth)/ - Route groups for authentication"
      api: "api/ - API routes"
      dynamic: "[dynamic]/ - Dynamic routes"
    components:
      ui: "Reusable UI components"
      features: "Feature-specific components"
      layouts: "Layout components"
    lib:
      api: "API client functions"
      db: "Database utilities"
      utils: "Helper functions"
    hooks: "Custom React hooks"
    services: "Business logic and external services"
    types: "TypeScript type definitions"
    styles: "Global styles and CSS modules"
    config: "Configuration files"
```

## 🔧 TypeScript Configuration

```yaml
typescript_config:
  tsconfig_requirements:
    strict: true
    noUncheckedIndexedAccess: true
    noImplicitAny: true
    strictNullChecks: true
    strictFunctionTypes: true
    strictBindCallApply: true
    strictPropertyInitialization: true
    noImplicitThis: true
    alwaysStrict: true
    noUnusedLocals: true
    noUnusedParameters: true
    noImplicitReturns: true
    noFallthroughCasesInSwitch: true
    forceConsistentCasingInFileNames: true

  type_definition_rules:
    - "Define explicit return types for all functions"
    - "Use unknown instead of any when type is truly unknown"
    - "Create dedicated type files for shared types"
    - "Use discriminated unions for complex state"
    - "Prefer interfaces for object shapes, types for unions/intersections"
```

## ⚛️ React & Next.js Patterns

```yaml
react_nextjs_patterns:
  component_structure:
    interface_definition: "Define explicit props interface"
    default_props: "Use default parameters in function signature"
    type_safety: "Explicit types for all props and handlers"
    example: |
      interface ButtonProps {
        variant: 'primary' | 'secondary';
        size?: 'sm' | 'md' | 'lg';
        onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
        children: React.ReactNode;
        disabled?: boolean;
        className?: string;
      }

  server_vs_client_components:
    default: "Default to Server Components"
    client_usage: "Use 'use client' only when necessary (interactivity, browser APIs, hooks)"
    composition: "Compose Server and Client Components properly"
    restrictions: "Never pass functions as props from Server to Client Components"

  data_fetching_rules:
    server_preferred: "Server Component preferred for data fetching"
    client_side: "Client Component only for client-side data needs"
    caching: "Use ISR with appropriate revalidation times"
    error_handling: "Always handle loading and error states"
```

## 🎨 Styling Guidelines

```yaml
styling_guidelines:
  css_modules_tailwind:
    approach: "CSS Modules with Tailwind utility classes"
    class_composition: "Use cn() utility for conditional classes"
    module_usage: "@apply directive for component styles"

  design_system_tokens:
    - "Use CSS variables for design tokens"
    - "Implement dark mode with CSS variables"
    - "Create consistent spacing scale"
    - "Use semantic color naming"
```

## 🧪 Testing Standards

```yaml
testing_standards:
  testing_stack:
    unit_tests: "Vitest or Jest"
    component_tests: "React Testing Library"
    e2e_tests: "Playwright"
    api_tests: "Supertest or MSW"

  test_requirements:
    - "Test user interactions and accessibility"
    - "Mock external dependencies"
    - "Test error states and loading states"
    - "Maintain minimum 80% code coverage"
    - "Write descriptive test names"

  test_structure:
    location: "__tests__/ directory alongside source files"
    naming: "Component.test.tsx for component tests"
    describe_blocks: "Group related tests logically"
    assertions: "Use specific, meaningful assertions"
```

## 🚀 Performance Optimization

```yaml
performance_optimization:
  image_optimization:
    component: "Always use Next.js Image component"
    priority: "Set priority for above-the-fold images"
    placeholder: "Use blur placeholder for better UX"
    responsive: "Provide multiple sizes for responsive images"

  bundle_optimization:
    - "Use dynamic imports for heavy components"
    - "Implement code splitting strategically"
    - "Lazy load non-critical components"
    - "Use next/dynamic with ssr: false for client-only components"

  caching_strategy:
    isr: "revalidate: 3600 # ISR: revalidate every hour"
    dynamic: "dynamic: 'force-dynamic' # For dynamic routes"
    static: "fetchCache: 'force-cache' # For static data"
```

## 🔒 Security Guidelines

```yaml
security_guidelines:
  input_validation:
    library: "Use zod for schema validation"
    sanitization: "Sanitize output with DOMPurify"
    validation_location: "Validate on both client and server"

  authentication_authorization:
    - "Use NextAuth.js or Clerk for authentication"
    - "Implement proper session management"
    - "Use middleware for route protection"
    - "Never expose sensitive data in client components"

  environment_variables:
    validation: "Use zod for environment variable validation"
    naming: "NEXT_PUBLIC_ prefix for client-accessible vars"
    secrets: "Never commit secrets to repository"
    validation_example: |
      const envSchema = z.object({
        DATABASE_URL: z.string().url(),
        NEXT_PUBLIC_API_URL: z.string().url(),
        SECRET_KEY: z.string().min(32)
      });
```

## ♿ Accessibility Standards

```yaml
accessibility_standards:
  aria_semantic_html:
    - "Use semantic HTML elements"
    - "Provide proper ARIA labels"
    - "Implement proper heading hierarchy"
    - "Use role attributes appropriately"

  keyboard_navigation:
    - "Ensure all interactive elements are keyboard accessible"
    - "Implement proper focus management"
    - "Use skip links for navigation"
    - "Test with keyboard only"

  form_accessibility:
    - "Associate labels with form controls"
    - "Provide error messages with aria-describedby"
    - "Use fieldsets for grouped form controls"
    - "Implement proper form validation feedback"
```

## 📝 Documentation Standards

```yaml
documentation_standards:
  component_documentation:
    jsdoc: "Use JSDoc for component documentation"
    examples: "Provide usage examples"
    props: "Document all props and their types"
    example: |
      /**
       * Button component with multiple variants and sizes
       * @example
       * ```tsx
       * <Button variant="primary" size="lg" onClick={handleClick}>
       *   Click me
       * </Button>
       * ```
       */

  api_documentation:
    - "Document parameters and return types"
    - "List possible exceptions"
    - "Provide usage examples"
    - "Document side effects"
```

## 📋 Git Commit Conventions

```yaml
git_commit_conventions:
  format: "<type>(<scope>): <subject>"
  types:
    feat: "New feature"
    fix: "Bug fix"
    docs: "Documentation changes"
    style: "Code formatting changes"
    refactor: "Code refactoring"
    perf: "Performance improvements"
    test: "Adding or updating tests"
    build: "Build system changes"
    ci: "CI/CD changes"
    chore: "Other changes"

  examples:
    - "feat(auth): add OAuth2 integration"
    - "fix(ui): resolve button hover state issue"
    - "docs(readme): update installation instructions"
    - "perf(images): optimize hero image loading"
```

## 🔄 Error Handling

```yaml
error_handling:
  error_boundaries:
    location: "app/error.tsx for Next.js error boundaries"
    client_directive: "Use 'use client' for error boundaries"
    reset_functionality: "Provide reset functionality"

  api_error_handling:
    custom_errors: "Create custom error classes"
    consistent_responses: "Return consistent error response format"
    logging: "Log unexpected errors for debugging"
    status_codes: "Use appropriate HTTP status codes"

  api_client_patterns:
    base_url_pattern: "Always use environment variable pattern for API base URL"
    example: |
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      
      // PREFERRED: Use authenticatedFetch for all API calls
      import { authenticatedFetch } from '@/lib/api';

      // Automatically handles authentication and API_URL prepending
      const response = await authenticatedFetch('/grafana/dashboards/variable-values', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grafanaDashboardId: dashboard.id,
          variableName: variable.name,
          system: systemName,
          environment: environment,
          existingVariables: variableValues
        }),
      });

      // ALTERNATIVE: Manual pattern (use only when authenticatedFetch not suitable)
      function getAuthHeaders(): Record<string, string> {
        const token = typeof window !== 'undefined' ? localStorage.getItem('perfana_access_token') : null;
        return token ? { 'Authorization': `Bearer ${token}` } : {};
      }

      const response = await fetch(`${env.API_URL}/endpoint`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
    authentication_headers: "PREFERRED: Use authenticatedFetch() - automatically handles auth headers and token refresh"
    error_handling: "authenticatedFetch() handles 401 responses with automatic token refresh"
    consistency: "ALWAYS use authenticatedFetch() with relative URLs (e.g., '/endpoint') - never hardcode URLs"
    fallback: "Use manual getAuthHeaders() pattern only when authenticatedFetch is not suitable"

  error_types:
    validation: "ValidationError for input validation failures"
    authentication: "UnauthorizedError for auth failures"
    not_found: "NotFoundError for missing resources"
    api: "APIError for general API failures"
```

## 🎯 Code Review Checklist

```yaml
code_review_checklist:
  typescript:
    - "TypeScript strict mode passes without errors"
    - "All functions have explicit return types"
    - "Components are properly typed with interfaces"

  react_nextjs:
    - "Error boundaries are implemented where needed"
    - "Loading and error states are handled"
    - "Server/Client components are used appropriately"

  forms_validation:
    - "Forms have proper validation and error messages"
    - "User input is validated on both client and server"

  api_patterns:
    - "API base URL uses environment variable pattern"
    - "Authentication headers included in all API calls"
    - "No hardcoded localhost URLs or relative API paths"

  performance:
    - "Images use Next.js Image component"
    - "Unnecessary re-renders are prevented"
    - "Large bundles are code-split"

  accessibility:
    - "Keyboard navigation works"
    - "ARIA labels are present"
    - "Color contrast meets WCAG standards"

  security:
    - "User input is validated and sanitized"
    - "Sensitive data is not exposed to client"
    - "Authentication is properly implemented"

  testing:
    - "Tests are written and passing"
    - "Edge cases are covered"
    - "Error states are tested"

  documentation:
    - "Documentation is updated"
    - "Complex logic is documented inline"
    - "Component props are documented"

  quality:
    - "Console has no errors or warnings"
    - "Code follows consistent formatting"
    - "Conventional commits are used"
```

## 🤖 Claude Code Specific Instructions

```yaml
claude_code_instructions:
  workflow:
    - "Always start with understanding the existing codebase structure"
    - "Follow these rules strictly - no exceptions"
    - "Write tests alongside implementation"
    - "Commit frequently with conventional commits"

  communication:
    - "Ask for clarification when requirements are ambiguous"
    - "Provide reasoning for architectural decisions"
    - "Suggest performance optimizations proactively"
    - "Flag potential security issues immediately"

  development_approach:
    - "Ensure accessibility from the start, not as an afterthought"
    - "Document complex logic inline"
    - "Quality over speed - better to write less code that follows all standards"
    - "Optimize for maintainability and readability"

  best_practices:
    - "Use TypeScript strict mode always"
    - "Implement proper error handling"
    - "Write self-documenting code"
    - "Follow established patterns in the codebase"
    - "Test edge cases and error conditions"
```

## 📊 Quality Gates

```yaml
quality_gates:
  before_commit:
    - "All TypeScript compilation errors resolved"
    - "All tests passing"
    - "ESLint/Prettier formatting applied"
    - "No console.log statements in production code"

  before_merge:
    - "Code review completed"
    - "All quality checks passing"
    - "Documentation updated"
    - "Breaking changes documented"

  continuous_monitoring:
    - "Bundle size within acceptable limits"
    - "Core Web Vitals scores maintained"
    - "Accessibility audit passing"
    - "Security scan results clean"
```

---

**Remember**: Quality over speed. It's better to write less code that follows all these standards than more code that doesn't.