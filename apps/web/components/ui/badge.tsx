'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'success' | 'warning' | 'error' | 'gray' | 'performance-excellent' | 'performance-good' | 'performance-fair' | 'performance-poor' | 'performance-critical'
  size?: 'sm' | 'base' | 'lg'
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ 
    className, 
    variant = 'primary', 
    size = 'base',
    leftIcon,
    rightIcon,
    children,
    ...props 
  }, ref) => {
    const baseClasses = 'badge'
    
    const variantClasses = {
      primary: 'badge-primary',
      success: 'badge-success',
      warning: 'badge-warning',
      error: 'badge-error',
      gray: 'badge-gray',
      'performance-excellent': 'badge-performance-excellent',
      'performance-good': 'badge-performance-good',
      'performance-fair': 'badge-performance-fair',
      'performance-poor': 'badge-performance-poor',
      'performance-critical': 'badge-performance-critical',
    }
    
    const sizeClasses = {
      sm: 'badge-sm',
      base: '',
      lg: 'badge-lg',
    }

    return (
      <span
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      >
        {leftIcon && leftIcon}
        {children}
        {rightIcon && rightIcon}
      </span>
    )
  }
)

Badge.displayName = 'Badge'

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, ...props }, ref) => {
    const statusVariants = {
      excellent: 'performance-excellent' as const,
      good: 'performance-good' as const,
      fair: 'performance-fair' as const,
      poor: 'performance-poor' as const,
      critical: 'performance-critical' as const,
    }

    return (
      <Badge
        variant={statusVariants[status]}
        ref={ref}
        {...props}
      />
    )
  }
)

StatusBadge.displayName = 'StatusBadge'