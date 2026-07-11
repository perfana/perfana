'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSidebar } from '@/contexts/sidebar-context'
import { useAuth } from '@/contexts/auth-context'
import { useThemeMode } from '@/contexts/theme-context'
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  Avatar,
  useTheme,
  Menu,
  MenuItem,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
} from '@mui/material'
import {
  Home,
  RocketLaunch,
  Storage,
  Cable,
  Settings,
  ChevronLeft,
  ChevronRight,
  Logout,
  AccountCircle,
  Tune,
  Business,
  Groups,
  DarkMode,
  LightMode,
  Schedule,
  History,
  Terminal,
  FileUpload,
} from '@mui/icons-material'
import { ThemePreference } from '@/contexts/theme-context'
import { GLOBAL_ADMIN_ROLES } from '@/lib/constants/roles'
import { OrganizationSelector } from './OrganizationSelector'
import { fetchAuditCapabilities } from '@/lib/audit-api'
import { env } from '@/lib/env'

interface NavigationItem {
  href: string
  label: string
  icon: React.ReactNode
  requiresRoles?: string[]  // If specified, user must have at least one of these roles
  requiresAnyRole?: boolean  // If true, just requires being authenticated (any role)
}

interface NavigationGroup {
  title: string
  items: NavigationItem[]
}

const getNavigationItems = (
  hasRole: (role: string) => boolean,
  hasAnyRole: (roles: string[]) => boolean,
  canViewAuditLogs: boolean,
): NavigationGroup[] => {
  const isGlobalAdmin = hasAnyRole(Array.from(GLOBAL_ADMIN_ROLES))

  return [
    {
      title: 'Overview',
      items: [
        { href: '/', label: 'Home', icon: <Home /> },
        { href: '/test-runs', label: 'Test Runs', icon: <RocketLaunch /> },
      ]
    },
    {
      title: 'Configuration',
      items: [
        { href: '/systems', label: 'Systems Under Test', icon: <Storage /> },
        { href: '/integrations', label: 'Integrations', icon: <Cable /> },
        // Organizations - visible to global admins
        ...(isGlobalAdmin ? [{
          href: '/settings/organizations',
          label: 'Organizations',
          icon: <Business />,
        }] : []),
        // Teams - visible to all authenticated users
        {
          href: '/settings/teams',
          label: 'Teams',
          icon: <Groups />,
        },
        { href: '/settings', label: 'Settings', icon: <Settings /> },
        { href: '/settings/profiles', label: 'Profiles', icon: <Tune /> },
        // Audit Logs — visible only to callers with cross-org or org-scoped
        // audit access (probed via /audit-logs/capabilities at mount time).
        ...(canViewAuditLogs ? [{
          href: '/audit-logs',
          label: 'Audit Logs',
          icon: <History />,
        }] : []),
        // Log Viewer — admin-only, feature-flagged (NEXT_PUBLIC_LOG_VIEWER_ENABLED).
        ...(env.LOG_VIEWER_ENABLED && isGlobalAdmin ? [{
          href: '/admin/logs',
          label: 'Log Viewer',
          icon: <Terminal />,
          requiresRoles: Array.from(GLOBAL_ADMIN_ROLES),
        }] : []),
        // SUT Import — admin-only, feature-flagged (NEXT_PUBLIC_SUT_TRANSFER_ENABLED).
        ...(env.SUT_TRANSFER_ENABLED && isGlobalAdmin ? [{
          href: '/admin/sut-import',
          label: 'SUT Import',
          icon: <FileUpload />,
          requiresRoles: Array.from(GLOBAL_ADMIN_ROLES),
        }] : []),
      ].filter(Boolean) as NavigationItem[]
    }
  ]
}

const DRAWER_WIDTH = 280
const COLLAPSED_WIDTH = 64

export function Sidebar() {
  const pathname = usePathname()
  const { isOpen, isMobile, close, toggle } = useSidebar()
  const { user, logout, hasRole, hasAnyRole } = useAuth()
  const { isDark, preference, setPreference } = useThemeMode()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [canViewAuditLogs, setCanViewAuditLogs] = useState(false)

  // Probe whether the current user can view audit logs. Hidden by default;
  // only revealed once the backend confirms cross-org or org-scoped access.
  // We re-probe whenever the authenticated user changes (login / logout).
  useEffect(() => {
    if (!user) {
      setCanViewAuditLogs(false)
      return
    }
    let cancelled = false
    fetchAuditCapabilities()
      .then(caps => {
        if (!cancelled) setCanViewAuditLogs(caps.canView)
      })
      .catch(() => {
        if (!cancelled) setCanViewAuditLogs(false)
      })
    return () => { cancelled = true }
  }, [user])

  // Get navigation items based on user roles
  const navigationItems = getNavigationItems(hasRole, hasAnyRole, canViewAuditLogs)

  const handleLinkClick = () => {
    if (isMobile) {
      close()
    }
  }

  const handleUserMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleUserMenuClose = () => {
    setAnchorEl(null)
  }

  const handleSignOut = async () => {
    handleUserMenuClose()
    await logout()
  }

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            component="img"
            src="/favicon.ico"
            alt="Perfana Logo"
            sx={{
              width: 32,
              height: 32,
              objectFit: 'contain',
            }}
          />
          {isOpen && (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight="bold" noWrap>
                Perfana
              </Typography>
            </Box>
          )}
        </Box>
        {!isMobile && (
          <IconButton onClick={toggle} size="small">
            {isOpen ? <ChevronLeft /> : <ChevronRight />}
          </IconButton>
        )}
      </Box>

      <Divider />

      {/* Organization Selector */}
      <OrganizationSelector />

      <Divider />

      {/* Navigation */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {navigationItems.map((group) => (
          <Box key={group.title}>
            {isOpen && (
              <Typography
                variant="overline"
                sx={{
                  px: 2,
                  py: 1,
                  display: 'block',
                  color: 'text.secondary',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              >
                {group.title}
              </Typography>
            )}
            <List sx={{ py: 0 }}>
              {group.items.map((item) => (
                <ListItem key={item.href} disablePadding>
                  <ListItemButton
                    component={Link}
                    href={item.href}
                    onClick={handleLinkClick}
                    selected={pathname === item.href}
                    sx={{
                      minHeight: 48,
                      justifyContent: isOpen ? 'initial' : 'center',
                      px: 2.5,
                      borderRadius: 1,
                      mx: 1,
                      mb: 0.5,
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        mr: isOpen ? 2 : 'auto',
                        justifyContent: 'center',
                        color: pathname === item.href ? 'primary.main' : 'inherit',
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      sx={{
                        opacity: isOpen ? 1 : 0,
                        '& .MuiListItemText-primary': {
                          fontSize: '0.875rem',
                          fontWeight: pathname === item.href ? 600 : 400,
                        },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 1 }} />
          </Box>
        ))}

      </Box>

      {/* Theme Toggle */}
      <Box sx={{ px: isOpen ? 2 : 0, py: 1 }}>
        <Divider sx={{ mb: 1 }} />
        {isOpen && (
          <Typography
            variant="overline"
            sx={{
              px: 2,
              py: 1,
              display: 'block',
              color: 'text.secondary',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
          >
            Theme
          </Typography>
        )}
        {isOpen ? (
          <Box sx={{ px: 1, py: 0.5 }}>
            <ToggleButtonGroup
              value={preference}
              exclusive
              onChange={(_, value: ThemePreference | null) => {
                if (value !== null) setPreference(value)
              }}
              size="small"
              fullWidth
              aria-label="Theme mode"
              sx={{
                height: 36,
                '& .MuiToggleButton-root': {
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  gap: 0.5,
                  py: 0.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  color: 'text.secondary',
                  '&.Mui-selected': {
                    backgroundColor: isDark ? 'rgba(56, 142, 232, 0.15)' : 'rgba(25, 118, 210, 0.08)',
                    color: 'primary.main',
                    borderColor: isDark ? 'rgba(56, 142, 232, 0.4)' : 'rgba(25, 118, 210, 0.3)',
                    '&:hover': {
                      backgroundColor: isDark ? 'rgba(56, 142, 232, 0.25)' : 'rgba(25, 118, 210, 0.15)',
                    },
                  },
                },
              }}
            >
              <ToggleButton value="light" aria-label="Light mode">
                <LightMode sx={{ fontSize: '1rem' }} />
                Light
              </ToggleButton>
              <ToggleButton value="dark" aria-label="Dark mode">
                <DarkMode sx={{ fontSize: '1rem' }} />
                Dark
              </ToggleButton>
              <ToggleButton value="auto" aria-label="Auto mode">
                <Schedule sx={{ fontSize: '1rem' }} />
                Auto
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Tooltip
              title={preference === 'light' ? 'Light mode' : preference === 'dark' ? 'Dark mode' : 'Auto mode'}
              placement="right"
            >
              <IconButton
                size="small"
                onClick={() => {
                  const next: ThemePreference = preference === 'light' ? 'dark' : preference === 'dark' ? 'auto' : 'light'
                  setPreference(next)
                }}
              >
                {preference === 'auto'
                  ? <Schedule sx={{ fontSize: '1.2rem' }} />
                  : isDark
                    ? <DarkMode sx={{ fontSize: '1.2rem' }} />
                    : <LightMode sx={{ fontSize: '1.2rem' }} />
                }
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box>
        <Divider />
        {isOpen && (
          <Typography
            variant="overline"
            sx={{
              px: 2,
              py: 1,
              display: 'block',
              color: 'text.secondary',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
          >
            Profile
          </Typography>
        )}
        {isOpen && user && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 1,
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: 'action.selected'
                }
              }}
              onClick={handleUserMenuClick}
            >
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                <AccountCircle />
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={500} noWrap>
                  {user.name || user.email.split('@')[0]}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user.email}
                </Typography>
              </Box>
            </Box>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleUserMenuClose}
              anchorOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
            >
              <MenuItem onClick={handleSignOut}>
                <ListItemIcon>
                  <Logout fontSize="small" />
                </ListItemIcon>
                Sign Out
              </MenuItem>
            </Menu>
          </Box>
        )}
        {!isOpen && user && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <IconButton size="small" onClick={handleUserMenuClick}>
              <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.main' }}>
                <AccountCircle sx={{ fontSize: '1.2rem' }} />
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleUserMenuClose}
              anchorOrigin={{
                vertical: 'center',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'center',
                horizontal: 'left',
              }}
            >
              <MenuItem onClick={handleSignOut}>
                <ListItemIcon>
                  <Logout fontSize="small" />
                </ListItemIcon>
                Sign Out
              </MenuItem>
            </Menu>
          </Box>
        )}
      </Box>
    </Box>
  )

  if (isMobile) {
    return (
      <Drawer
        anchor="left"
        open={isOpen}
        onClose={close}
        ModalProps={{
          keepMounted: true, // Better mobile performance
        }}
        sx={{
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: DRAWER_WIDTH,
            bgcolor: 'background.paper',
          },
        }}
      >
        {drawerContent}
      </Drawer>
    )
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: isOpen ? DRAWER_WIDTH : COLLAPSED_WIDTH,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        '& .MuiDrawer-paper': {
          width: isOpen ? DRAWER_WIDTH : COLLAPSED_WIDTH,
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          overflowX: 'hidden',
          bgcolor: 'background.paper',
          borderRight: '1px solid',
          borderRightColor: 'divider',
        },
      }}
    >
      {drawerContent}
    </Drawer>
  )
}