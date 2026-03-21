# DeepLinks Feature Migration Plan

## Overview

The DeepLinks feature allows users to create custom URL links associated with specific system/environment/workload combinations. These links support dynamic variable substitution using test run data and configuration values, making them valuable for linking to external monitoring systems, dashboards, or CI/CD results.

## Current Feature Analysis

### MongoDB Schema (deepLinks collection)
```javascript
{
  application: String,      // System under test
  testType: String,        // Workload  
  testEnvironment: String, // Environment
  name: String,           // Display name for the link
  url: String,           // URL with placeholder variables
  genericDeepLinkId: String (optional) // Reference to template link
}
```

### Key Functionality

1. **Variable Substitution**: URLs support 15+ placeholder variables:
   - `{perfana-system-under-test}`, `{perfana-test-environment}`, `{perfana-workload}`
   - `{perfana-test-run-id}`, `{perfana-build-result-url}`
   - Time-based: `{perfana-start-epoch-milliseconds}`, `{perfana-end-epoch-seconds}`
   - Format-specific: `{perfana-start-dynatrace}`, `{perfana-start-elasticsearch}`
   - Reference links: `{perfana-previous-test-run-id}`, `{perfana-baseline-test-run-id}`
   - Custom config variables from `TestRunConfigs` collection

2. **Permission-Based Access**: Users need application permissions to create/edit/delete links

3. **Validation**: Invalid links (with unresolved variables) are displayed with error messages

## PostgreSQL Migration Design

### New Tables

#### deep_links table
```sql
CREATE TABLE deep_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_under_test_id UUID NOT NULL REFERENCES systems_under_test(id) ON DELETE CASCADE,
    test_environment VARCHAR(255) NOT NULL,
    workload VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    template_deep_link_id UUID REFERENCES deep_links(id), -- For generic templates
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Composite index for lookups
    INDEX idx_deep_links_lookup (system_under_test_id, test_environment, workload)
);
```

## Backend Implementation (NestJS)

### API Endpoints

```typescript
// Deep Links Module
@Controller('deep-links')
export class DeepLinksController {
  
  @Get()
  async getDeepLinks(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,  
    @Query('workload') workload: string,
    @Query('testRunId') testRunId?: string
  ): Promise<DeepLink[]>
  
  @Post()
  @UseGuards(CombinedAuthGuard)
  async createDeepLink(@Body() createDto: CreateDeepLinkDto): Promise<DeepLink>
  
  @Put(':id')
  @UseGuards(CombinedAuthGuard)
  async updateDeepLink(
    @Param('id') id: string,
    @Body() updateDto: UpdateDeepLinkDto
  ): Promise<DeepLink>
  
  @Delete(':id')
  @UseGuards(CombinedAuthGuard)
  async deleteDeepLink(@Param('id') id: string): Promise<void>
  
  @Get(':id/resolve')
  async resolveDeepLinkVariables(
    @Param('id') id: string,
    @Query('testRunId') testRunId: string
  ): Promise<ResolvedDeepLink>
}
```

### DTOs

```typescript
export class CreateDeepLinkDto {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  name: string;
  url: string;
  templateDeepLinkId?: string;
}

export class ResolvedDeepLink {
  id: string;
  name: string;
  url: string;
  isValid: boolean;
  unresolvedVariables?: string[];
}
```

### Services

```typescript
@Injectable()
export class DeepLinksService {
  
  async findBySystemEnvWorkload(
    systemUnderTestId: string,
    testEnvironment: string, 
    workload: string
  ): Promise<DeepLink[]>
  
  async resolveVariables(
    deepLink: DeepLink,
    testRun: TestRun
  ): Promise<ResolvedDeepLink>
  
  private replaceStandardVariables(url: string, testRun: TestRun): string
  private replaceConfigVariables(url: string, testRunId: string): Promise<string>
  private replaceReferenceVariables(url: string, testRun: TestRun): Promise<string>
}
```

### Variable Resolution Engine

The service will implement comprehensive variable replacement:

1. **Standard Variables**: System, environment, workload, timestamps
2. **Test Run Variables**: Start/end times in multiple formats
3. **Reference Variables**: Previous/baseline test run IDs
4. **Configuration Variables**: Dynamic lookup from `test_run_configs`
5. **Build Variables**: CI/CD integration URLs

## Frontend Implementation (Next.js)

### Components Structure

#### System Configuration Integration
```typescript
// apps/web/app/systems/[id]/config/page.tsx
// Add new "Deep Links" tab to existing system configuration tabs
// Similar to how Dashboards tab is implemented

// components/systems/deep-links/DeepLinksTab.tsx
export function DeepLinksTab({ 
  systemId: string,
  environments: string[],
  workloads: string[]
})

// components/systems/deep-links/DeepLinksTable.tsx  
export function DeepLinksTable({ 
  systemUnderTestId: string, 
  testEnvironment: string, 
  workload: string,
  readonly?: boolean 
})

// components/systems/deep-links/DeepLinkModal.tsx
export function DeepLinkModal({
  deepLink?: DeepLink,
  systemUnderTestId: string,
  testEnvironment: string,
  workload: string,
  onSave: (deepLink: DeepLink) => void
})
```

#### Test Run Details Integration
```typescript
// apps/web/app/test-runs/[id]/page.tsx  
// Add new DeepLinksCard to existing test run details cards

// components/test-runs/DeepLinksCard.tsx
export function DeepLinksCard({ 
  testRunId: string,
  systemUnderTestId: string,
  testEnvironment: string, 
  workload: string
})
```

### Key Features

1. **Variable Autocomplete**: Input field with mention-style variable insertion
2. **Link Validation**: Real-time validation with unresolved variable highlighting  
3. **Permission Handling**: Show/hide edit functionality based on user permissions
4. **Responsive Design**: Mobile-friendly table layout
5. **Error Handling**: Clear messaging for invalid links

### Integration Points

- **System Config Page**: New "Deep Links" tab in system configuration tabs
- **Test Run Details Page**: New card displaying resolved links for the specific test run
- **Permission System**: Integrate with existing auth patterns

## Migration Timeline

### Phase 1: Database Schema (Week 1)
- [ ] Create migration file for `deep_links` table
- [ ] Add indexes and constraints
- [ ] Test schema with seed data

### Phase 2: Backend API (Week 2)
- [ ] Implement NestJS module, controller, service
- [ ] Create DTOs and validation
- [ ] Implement variable resolution engine
- [ ] Add comprehensive test coverage
- [ ] API documentation with Swagger

### Phase 3: Frontend Components (Week 3)  
- [ ] Add DeepLinks tab to system config page
- [ ] Build DeepLinks management components (table, modal, forms)
- [ ] Add DeepLinks card to test run details page
- [ ] Implement variable autocomplete
- [ ] Add form validation and error handling
- [ ] Integrate with auth system
- [ ] Responsive design implementation

### Phase 4: Integration & Testing (Week 4)
- [ ] End-to-end integration testing
- [ ] Performance testing for variable resolution
- [ ] User acceptance testing
- [ ] Documentation updates
- [ ] Production deployment

## Risk Mitigation

1. **Data Integrity**: Comprehensive validation during implementation
2. **Performance**: Efficient querying with proper indexes
3. **Security**: Maintain permission-based access control
4. **Variable Expansion**: Extensive testing of all placeholder scenarios

## Success Criteria

- [ ] All existing deeplinks functionality preserved
- [ ] Variable substitution works identically to legacy system  
- [ ] Permission system maintains security boundaries
- [ ] Performance meets or exceeds legacy system
- [ ] Comprehensive test coverage (>90%)
- [ ] Full API documentation available
- [ ] Seamless integration with existing system config and test run pages