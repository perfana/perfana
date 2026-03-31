import { Logger } from '@nestjs/common';
import { KeycloakAdminService } from '../../modules/auth/keycloak-admin.service';

export interface UserInfo {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  enabled: boolean;
  emailVerified: boolean;
}

/**
 * Get a human-readable display name for a user.
 */
export function getDisplayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
  username: string;
}): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }
  if (user.firstName) return user.firstName;
  if (user.lastName) return user.lastName;
  if (user.email) return user.email;
  return user.username;
}

/**
 * Enrich a list of member objects (org or team) with user info from Keycloak.
 * Fetches user info in parallel and returns a map keyed by user_id.
 */
export async function fetchUserInfoMap(
  userIds: string[],
  keycloakAdminService: KeycloakAdminService,
  logger: Logger,
): Promise<Map<string, UserInfo>> {
  const userInfoMap = new Map<string, UserInfo>();

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        // Skip API keys (they start with 'api-key:')
        if (userId.startsWith('api-key:')) {
          userInfoMap.set(userId, {
            username: userId,
            displayName: 'API Key',
            enabled: true,
            emailVerified: false,
          });
          return;
        }

        const user = await keycloakAdminService.getUserById(userId);

        if (user) {
          userInfoMap.set(userId, {
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            displayName: getDisplayName(user),
            enabled: user.enabled,
            emailVerified: user.emailVerified,
          });
        } else {
          userInfoMap.set(userId, {
            username: userId,
            displayName: userId,
            enabled: false,
            emailVerified: false,
          });
        }
      } catch (error) {
        logger.warn(`Failed to fetch user info for ${userId}:`, error);
        userInfoMap.set(userId, {
          username: userId,
          displayName: userId,
          enabled: false,
          emailVerified: false,
        });
      }
    })
  );

  return userInfoMap;
}
