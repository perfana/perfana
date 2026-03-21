'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import keycloakAuth from '@/lib/keycloak-auth'
import { loadRuntimeConfig } from '@/lib/runtime-config'

export interface User {
  id: string
  email: string
  name?: string
  created_at: string
  roles?: string[]
  organizations?: string[]
  teams?: string[]
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  hasRole: (role: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check for existing session on mount
  useEffect(() => {
    initializeAuth()
  }, [])

  const initializeAuth = async () => {
    try {
      if (typeof window !== 'undefined') {
        // Load runtime config first (fetches env vars from /api/config)
        await loadRuntimeConfig()

        const keycloakAuthenticated = await keycloakAuth.init()

        if (keycloakAuthenticated) {
          const keycloakUser = keycloakAuth.getUserInfo()
          if (keycloakUser) {
            setUser({
              id: keycloakUser.sub,
              email: keycloakUser.email,
              name: keycloakUser.name,
              created_at: new Date().toISOString(),
              roles: keycloakUser.roles,
              organizations: keycloakUser.organizations,
              teams: keycloakUser.teams,
            })
          }
        }
      }
    } catch (error) {
      console.error('Auth initialization failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async () => {
    await keycloakAuth.login()
  }

  const logout = async () => {
    await keycloakAuth.logout()
    setUser(null)
  }

  const hasRole = (role: string): boolean => {
    return keycloakAuth.hasRole(role)
  }

  const hasAnyRole = (roles: string[]): boolean => {
    return keycloakAuth.hasAnyRole(roles)
  }

  const value = {
    user,
    isLoading,
    login,
    logout,
    hasRole,
    hasAnyRole,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
