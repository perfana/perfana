'use client'

import { useSidebar } from '@/contexts/sidebar-context'
import { IconButton, Tooltip } from '@mui/material'
import { Menu, MenuOpen } from '@mui/icons-material'

export function SidebarToggle() {
  const { isOpen, toggle } = useSidebar()

  return (
    <Tooltip title={isOpen ? 'Close sidebar' : 'Open sidebar'}>
      <IconButton
        onClick={toggle}
        size="medium"
        sx={{
          transition: 'transform 0.2s ease-in-out',
        }}
        aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {isOpen ? <MenuOpen /> : <Menu />}
      </IconButton>
    </Tooltip>
  )
}