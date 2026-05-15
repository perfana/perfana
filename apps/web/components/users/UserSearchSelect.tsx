'use client';

import React, { useState, useMemo } from 'react';
import {
  Box,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Typography,
  CircularProgress,
  Alert,
  InputAdornment,
  Chip,
} from '@mui/material';
import { Search as SearchIcon, Email as EmailIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useUserSearch } from '@/lib/hooks/use-user-search';
import { UserInfo } from '@/lib/api/users';
import { useDebounce } from '@/lib/hooks/use-debounce';

interface UserSearchSelectProps {
  onSelect: (user: UserInfo) => void;
  selectedUserId?: string;
  excludeUserIds?: string[]; // Users to hide from results (already members)
  placeholder?: string;
}

/**
 * User search and select component for adding members
 *
 * Features:
 * - Real-time search with debouncing
 * - Displays human-readable user information (name, email, username)
 * - Highlights selected user
 * - Filters out users already in the list
 * - Shows verification status
 */
export function UserSearchSelect({
  onSelect,
  selectedUserId,
  excludeUserIds = [],
  placeholder = 'Search by name, email, or username...',
}: UserSearchSelectProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 300); // 300ms debounce

  const { data: users = [], isLoading, error } = useUserSearch(
    { q: debouncedQuery, limit: 20 },
    { enabled: debouncedQuery.length >= 2 },
  );

  // Filter out excluded users
  const filteredUsers = useMemo(() => {
    return users.filter((user) => !excludeUserIds.includes(user.id));
  }, [users, excludeUserIds]);

  /**
   * Get user initials for avatar
   */
  const getUserInitials = (user: UserInfo): string => {
    if (user.firstName && user.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user.firstName) {
      return user.firstName[0].toUpperCase();
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return user.username[0].toUpperCase();
  };

  /**
   * Get user secondary text (email + username)
   */
  const getUserSecondary = (user: UserInfo): string => {
    const parts: string[] = [];
    if (user.email) parts.push(user.email);
    if (user.username !== user.email) parts.push(`@${user.username}`);
    return parts.join(' • ');
  };

  return (
    <Box>
      <TextField
        fullWidth
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              {isLoading ? <CircularProgress size={20} /> : <SearchIcon />}
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
        autoFocus
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to search users. Please try again.
        </Alert>
      )}

      {!error && debouncedQuery.length > 0 && debouncedQuery.length < 2 && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          Type at least 2 characters to search
        </Typography>
      )}

      {!error && debouncedQuery.length >= 2 && filteredUsers.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          No users found
        </Typography>
      )}

      {filteredUsers.length > 0 && (
        <List
          sx={{
            maxHeight: '400px',
            overflow: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          {filteredUsers.map((user) => (
            <ListItem key={user.id} disablePadding>
              <ListItemButton
                onClick={() => onSelect(user)}
                selected={selectedUserId === user.id}
                sx={{
                  '&.Mui-selected': {
                    backgroundColor: 'primary.light',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                    },
                  },
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    sx={{
                      bgcolor: selectedUserId === user.id ? 'primary.dark' : 'primary.main',
                    }}
                  >
                    {selectedUserId === user.id ? (
                      <CheckCircleIcon />
                    ) : (
                      getUserInitials(user)
                    )}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" component="span">
                        {user.displayName}
                      </Typography>
                      {!user.enabled && (
                        <Chip label="Disabled" size="small" color="error" />
                      )}
                      {user.emailVerified && (
                        <Chip
                          icon={<EmailIcon fontSize="small" />}
                          label="Verified"
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography variant="body2" color="text.secondary" component="span">
                      {getUserSecondary(user)}
                    </Typography>
                  }
                  sx={{
                    color: selectedUserId === user.id ? 'inherit' : 'text.primary',
                    '& .MuiListItemText-secondary': {
                      color: selectedUserId === user.id ? 'inherit' : 'text.secondary',
                      opacity: selectedUserId === user.id ? 0.9 : 1,
                    },
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}

      {filteredUsers.length > 0 && users.length > filteredUsers.length && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {users.length - filteredUsers.length} user(s) hidden (already members)
        </Typography>
      )}
    </Box>
  );
}
