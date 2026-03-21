'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'base' | 'lg'
}

export const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = 'base', ...props }, ref) => {
    const sizeClasses = {
      sm: 'spinner-sm',
      base: '',
      lg: 'spinner-lg',
    }

    return (
      <div
        ref={ref}
        className={cn('spinner', sizeClasses[size], className)}
        {...props}
      />
    )
  }
)

Spinner.displayName = 'Spinner'