# Events

Create and manage events (annotations) for test runs and systems.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /events | List events with filtering |
| GET | /events/by-test-run/:testRunId | Events for specific test run |
| POST | /events | Create event |
| PATCH | /events/:id | Update event |
| DELETE | /events/:id | Delete event |
