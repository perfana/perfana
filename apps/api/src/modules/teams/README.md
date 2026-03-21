# Teams

Manage teams and team memberships with role-based access control.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /teams | List all accessible teams |
| GET | /teams/:id | Get single team details |
| POST | /teams | Create new team (org admin) |
| PUT | /teams/:id | Update team |
| DELETE | /teams/:id | Delete team |
| GET | /teams/:teamId/members | List team members |
| POST | /teams/:teamId/members | Add team member |
| DELETE | /team-members/:id | Remove member |
