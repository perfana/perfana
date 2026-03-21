# Systems Under Test

Configure and manage systems being monitored for performance testing.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /systems-under-test | List all systems |
| GET | /systems-under-test/:id | Get system with environment/workload data |
| PATCH | /systems-under-test/:id | Update system properties |
| PATCH | /systems-under-test/:id/pyroscope | Update Pyroscope configuration |
| GET | /systems-under-test/:id/delete-preview | Preview cascading deletions |
| DELETE | /systems-under-test/:id | Delete system and related data |
