# Report Section Configurations

This document describes the configuration options for each report section type.

## Section Types

### 1. `header` - Report Header/Cover Page

Creates a professional cover page and test run summary.

**Configuration Options:**

```typescript
{
  type: 'header',
  order: 0,
  config: {
    title?: string;              // Default: 'Performance Test Report'
    subtitle?: string;           // Optional subtitle
    includeTimestamp?: boolean;  // Default: true
    includeTestRunInfo?: boolean; // Default: true
    includeCoverPage?: boolean;  // Default: true - show cover page
    includeSummary?: boolean;    // Default: true - show summary section
  }
}
```

**Features:**
- Professional cover page with gradient title
- Test run information card (System, Environment, Workload, Test Run ID, Date)
- Test run summary section with 3x3 info grid
- Status badges for SLO and Anomaly Detection
- Annotations display

---

### 2. `text_block` - Custom Text Content

Displays custom text content with optional alignment.

**Configuration Options:**

```typescript
{
  type: 'text_block',
  order: 1,
  config: {
    content: string;    // Text content to display
    alignment?: 'left' | 'center' | 'right'; // Default: 'left'
  }
}
```

---

### 3. `transaction_response_times` - Transaction Performance Metrics

Displays transaction response times for a specific scenario or all scenarios.

**Configuration Options:**

```typescript
{
  type: 'transaction_response_times',
  order: 4,
  title?: string;                    // Default: '📈 Transaction Response Times'
  comment?: string;                  // Optional stakeholder comment
  config: {
    scenario: string;                // Scenario name: 'BrowseAndSearch', 'Checkout', 'all', etc.
    includeChart?: boolean;          // Default: true - show line chart
    includeSummary?: boolean;        // Default: true - show summary metrics
  }
}
```

**Features:**
- Scenario name displayed in uppercase header
- Summary metrics grid (8 metrics):
  - Peak Txns/Sec, Peak Reqs/Sec, Peak VU, Errors
  - Avg (MS), P95 (MS), P99 (MS), Apdex
- Line chart placeholder for response times over time (TODO: integrate Chart.js)
- Transaction table with columns:
  - Transaction Name, Avg (MS), 95th (MS), 99th (MS), Pass, Fail, Err %
- Color-coded values:
  - Pass counts in green
  - Fail counts in red
  - Error percentages in orange

**Available Scenarios (Mock Data):**
- `BrowseAndSearch` - 7 transactions (Homepage, Browse, Search, etc.)
- `Checkout` - 7 transactions (Cart, Login, Shipping, Payment, etc.)
- `all` - Combined view of all scenarios

**Example Usage:**

```typescript
// Show BrowseAndSearch scenario
{
  type: 'transaction_response_times',
  order: 4,
  title: 'Transaction Response Times',
  comment: 'Analysis shows good performance across browse/search operations',
  config: {
    scenario: 'BrowseAndSearch',
    includeChart: true,
    includeSummary: true
  }
}

// Show Checkout scenario without chart
{
  type: 'transaction_response_times',
  order: 5,
  config: {
    scenario: 'Checkout',
    includeChart: false,
    includeSummary: true
  }
}

// Show all scenarios
{
  type: 'transaction_response_times',
  order: 6,
  config: {
    scenario: 'all',
    includeChart: true,
    includeSummary: true
  }
}
```

**TODO:**
- Replace mock data with actual transaction data from test run metrics
- Integrate Chart.js or similar library for interactive line charts
- Add data fetching service to query transaction metrics by scenario
- Support custom scenario filtering via configuration
- Add ability to select specific transactions within a scenario

---

### 4. `apdex` - Apdex Scores

Displays Apdex (Application Performance Index) scores for overall test and individual scenarios.

**Configuration Options:**

```typescript
{
  type: 'apdex',
  order: 3,
  title?: string;                    // Default: 'Apdex Scores'
  comment?: string;                  // Optional stakeholder comment
  config: {
    scenarios?: string[] | 'all';    // Array of scenario names or 'all' for all scenarios
                                     // Default: all scenarios if not specified
    showOverallMetrics?: boolean;    // Default: true - show overall test metrics
    apdexThreshold?: number;         // Default: 500 (T value in milliseconds)
  }
}
```

**Features:**
- Star icon header with "APPLICATION PERFORMANCE INDEX" subtitle
- Overall Test Metrics section with 8 metric cards:
  - Peak Txns/Sec, Peak Reqs/Sec, Peak Active Users (with Avg subtitle), Transaction Error Rate (with failed count)
  - Avg Response Time (weighted average), P95 Response Time (95th percentile), P99 Response Time (99th percentile), Overall Apdex Score (with T threshold)
- Scenarios section with blue left border for each scenario, containing:
  - Scenario name header
  - 8 metric cards per scenario (Peak Txns/Sec, Peak Reqs/Sec, Peak Active Users, Errors, Avg(MS), P95(MS), P99(MS), Apdex Score)
  - Transaction table with columns: Transaction, Avg(MS), 95th(MS), 99th(MS), Pass, Fail, Err%, Apdex
  - Apdex threshold note at bottom of table
- Color-coded values:
  - Blue for primary metrics (Txns/Sec, Active Users, Avg times)
  - Purple for secondary metrics (Reqs/Sec)
  - Green for good scores (Apdex, low errors, Pass counts)
  - Red for high error rates and fail counts
  - Orange for warnings (P95 times, moderate errors)

**Available Scenarios (Mock Data):**
- `BrowseAndSearch` - 7 transactions with Apdex scores
- `Checkout` - 7 transactions with Apdex scores
- `all` - Shows both scenarios

**Apdex Score Interpretation:**
- 1.0 = Perfect (all responses within threshold)
- 0.94-0.99 = Excellent
- 0.85-0.93 = Good
- 0.70-0.84 = Fair
- 0.50-0.69 = Poor
- < 0.50 = Unacceptable

**Example Usage:**

```typescript
// Show all scenarios with default threshold (500ms)
{
  type: 'apdex',
  order: 3,
  title: 'Apdex Scores',
  comment: 'Overall Apdex score of 0.992 indicates excellent user experience',
  config: {
    scenarios: 'all',
    showOverallMetrics: true,
    apdexThreshold: 500
  }
}

// Show specific scenarios with custom threshold
{
  type: 'apdex',
  order: 3,
  config: {
    scenarios: ['BrowseAndSearch', 'Checkout'],
    showOverallMetrics: true,
    apdexThreshold: 1000  // More lenient threshold for slow operations
  }
}

// Show only BrowseAndSearch scenario without overall metrics
{
  type: 'apdex',
  order: 3,
  config: {
    scenarios: ['BrowseAndSearch'],
    showOverallMetrics: false,
    apdexThreshold: 500
  }
}
```

**TODO:**
- Replace mock data with actual Apdex calculations from test run metrics
- Implement Apdex score calculation based on satisfied/tolerating/frustrated thresholds
- Add data fetching service to query transaction response times by scenario
- Support custom threshold configuration per transaction/scenario
- Add Apdex trend visualization showing score changes over time

---

### 5. `slo` - SLO Results

Displays Service Level Objective (SLO) results.

**Configuration Options:**

```typescript
{
  type: 'slo',
  order: 2,
  title?: string;     // Default: 'SLO Results'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 6. `regressions` - Performance Regressions

Displays detected performance regressions.

**Configuration Options:**

```typescript
{
  type: 'regressions',
  order: 7,
  title?: string;     // Default: 'Regressions'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 7. `awr` - AWR Analysis

Displays Oracle AWR (Automatic Workload Repository) analysis.

**Configuration Options:**

```typescript
{
  type: 'awr',
  order: 8,
  title?: string;     // Default: 'AWR Analysis'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 8. `trends` - Performance Trends

Displays performance trends over multiple test runs.

**Configuration Options:**

```typescript
{
  type: 'trends',
  order: 9,
  title?: string;     // Default: 'Trends'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 9. `comparisons` - Test Run Comparisons

Displays comparisons between test runs.

**Configuration Options:**

```typescript
{
  type: 'comparisons',
  order: 10,
  title?: string;     // Default: 'Comparisons'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 10. `graphs` - Custom Graphs

Displays custom graphs and visualizations.

**Configuration Options:**

```typescript
{
  type: 'graphs',
  order: 11,
  title?: string;     // Default: 'Custom Graphs'
  comment?: string;   // Optional stakeholder comment
}
```

**TODO:** Implement data fetching and rendering

---

### 11. `index` - Section Index

Renders a linked list of the report's sections, in the order they appear, so readers can jump straight to the one they want.

**Configuration Options:**

```typescript
{
  type: 'index',
  order: 0,
  title?: string;     // Default: 'Index'
  comment?: string;   // Optional stakeholder comment, rendered above the list
}
```

This section has no settings of its own beyond the standard fields every section carries. Its list is built automatically from the other sections already in the report — there is nothing to set beyond where it sits in the running order, an optional title override, and the standard accompanying-text field (`comment`), which renders above its list.

**Features:**
- One entry per linkable section, in report order
- Each entry links to that section's anchor
- Text blocks, headers, and other index sections are never listed — none of them have an anchor of their own (see "Linking to Sections" below)
- An index with no linkable sections in the report, and no accompanying text of its own, renders nothing at all — not even its heading. A report made up of only an index and text blocks/headers would show no sign of the index; add a linkable section, or give the index some accompanying text, to make it appear.

---

## Linking to Sections

Any section can be linked from a text block or from a section's own accompanying text, using ordinary markdown:

```markdown
[See the SLO results](#section-slo-results)
```

The link target is a slug built from the section's title as the report renders it: lowercased, with accents stripped and every run of non-alphanumeric characters collapsed to a single `-`, then namespaced with a `section-` prefix. "SLO Results" becomes `section-slo-results`. If a section has no title of its own, the anchor is built from its default type heading instead — an untitled `slo` section still anchors at `#section-slo-results`.

The `section-` prefix exists so a section's anchor can never collide with an id some other part of the report stamps from unrelated data — for example, drill-down table rows keyed off transaction names (`r-checkout`, `c-mid`, `b-reg`). Without it, a section titled "R Checkout" would slug to the bare `r-checkout` and silently share an id with such a row; the browser would then resolve `#r-checkout` to whichever element comes first in the document, which may not be the section at all.

**Text blocks, headers, and indexes cannot be linked to.** A text block is where you write links from, not something other sections can link to. A header is the report's title block at the very top, so linking to it is pointless — you're already there. An index linking to an index is circular noise. All three get no anchor and never appear in the index.

**Give sections distinct titles.** Two sections that share a title make their links ambiguous: the second one gets a numbered suffix (`-2`, `-3`, ...), and later deleting or reordering either section can silently repoint an existing link at the wrong one. Report generation warns about duplicate titles, but it does not block generation.

You don't have to work the slug out by hand — the editor toolbar has a "Link to section" button that inserts the correct markdown for the section you pick. Links work the same way in both the HTML report and the generated PDF.

---

## Complete Example Template

```typescript
{
  name: 'Complete Performance Report',
  description: 'Full performance test report with all sections',
  system_id: 'PerfanaWebshop',
  test_environment: 'acc',
  workload: 'loadTest',
  sections: [
    // Cover page and summary
    {
      type: 'header',
      order: 0,
      config: {
        title: 'Performance Test Report',
        subtitle: 'Load Test Results',
        includeCoverPage: true,
        includeSummary: true
      }
    },
    // Custom intro text
    {
      type: 'text_block',
      order: 1,
      config: {
        content: 'This report presents the results of the load test conducted on the PerfanaWebshop application.',
        alignment: 'left'
      }
    },
    // SLO results
    {
      type: 'slo',
      order: 2,
      comment: 'Most SLOs passed with acceptable margins'
    },
    // Apdex scores
    {
      type: 'apdex',
      order: 3,
      comment: 'Overall Apdex score of 0.992 indicates excellent user experience'
    },
    // BrowseAndSearch transactions
    {
      type: 'transaction_response_times',
      order: 4,
      config: {
        scenario: 'BrowseAndSearch',
        includeChart: true,
        includeSummary: true
      }
    },
    // Checkout transactions
    {
      type: 'transaction_response_times',
      order: 5,
      config: {
        scenario: 'Checkout',
        includeChart: true,
        includeSummary: true
      }
    }
  ],
  styling: {
    primaryColor: '#1976d2',
    secondaryColor: '#9c27b0',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  }
}
```

---

## Data Integration TODO

### Transaction Response Times

Current implementation uses mock data. To integrate real data:

1. **Create Transaction Entity/Service:**
   ```typescript
   // packages/shared/src/entities/transaction.entity.ts
   @Entity('transactions')
   export class Transaction {
     @PrimaryGeneratedColumn('uuid')
     id: string;

     @Column()
     test_run_id: string;

     @Column()
     scenario: string;

     @Column()
     transaction_name: string;

     @Column('float')
     avg_ms: number;

     @Column('float')
     p95_ms: number;

     @Column('float')
     p99_ms: number;

     @Column('integer')
     pass_count: number;

     @Column('integer')
     fail_count: number;

     @Column('float')
     error_percentage: number;
   }
   ```

2. **Create Data Fetching Service:**
   ```typescript
   // apps/api/src/modules/reports/services/transaction-data.service.ts
   async getScenarioData(testRunId: string, scenario: string) {
     // Fetch from transactions table or metrics API
     // Calculate summary statistics
     // Return in format expected by rendering methods
   }
   ```

3. **Update renderTransactionResponseTimesSection:**
   - Replace `getMockScenarioData()` with real data service call
   - Handle cases where no data is available
   - Add error handling and fallbacks
