'use client'

import { useAuth } from '@/contexts/auth-context'
import { AppShell } from './app-shell'
import { usePathname } from 'next/navigation'

interface AuthLayoutProps {
  children: React.ReactNode
}

const publicRoutes = ['/signin', '/signup', '/forgot-password']

export function AuthLayout({ children }: AuthLayoutProps) {
  const { user, isLoading } = useAuth()
  const pathname = usePathname()
  
  const isPublicRoute = publicRoutes.includes(pathname)
  
  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner spinner-lg"></div>
      </div>
    )
  }
  
  // If it's a public route, don't wrap with AppShell
  if (isPublicRoute) {
    return <>{children}</>
  }
  
  // If user is not authenticated and trying to access protected route, redirect to signin
  if (!user) {
    if (typeof window !== 'undefined') {
      // Save the current path so we can return after login
      const returnTo = window.location.pathname + window.location.search
      if (returnTo !== '/' && returnTo !== '/signin') {
        sessionStorage.setItem('perfana_return_to', returnTo)
      }
      window.location.href = '/signin'
    }
    return null
  }
  
  // User is authenticated, show app shell
  return <AppShell>{children}</AppShell>
}