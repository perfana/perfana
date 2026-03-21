'use client'

import { Sidebar } from './sidebar'
import { useSidebar } from '@/contexts/sidebar-context'
import { cn } from '@/lib/utils'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isOpen, isMobile } = useSidebar()

  return (
    <div className="app-shell">
      <Sidebar />
      <div className={cn(
        'main-content transition-all duration-300 ease-in-out',
        !isOpen && !isMobile ? 'main-content-collapsed' : ''
      )}>
        <main className="content-area">
          {children}
        </main>
      </div>
    </div>
  )
}