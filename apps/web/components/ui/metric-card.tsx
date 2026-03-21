'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string | number
  label: string
  change?: {
    value: string | number
    direction: 'positive' | 'negative' | 'neutral'
  }
  icon?: React.ReactNode
}

export const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ className, value, label, change, icon, ...props }, ref) => {
    const getChangeClasses = (direction: string) => {
      const classes = {
        positive: 'metric-change-positive',
        negative: 'metric-change-negative',
        neutral: 'metric-change-neutral',
      }
      return classes[direction as keyof typeof classes]
    }

    return (
      <div
        ref={ref}
        className={cn('metric-card', className)}
        {...props}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="metric-label">
            {label}
          </div>
          {icon && (
            <div className="text-gray-400">
              {icon}
            </div>
          )}
        </div>
        
        <div className="metric-value">
          {value}
        </div>
        
        {change && (
          <div className={cn('metric-change', getChangeClasses(change.direction))}>
            <span className="text-xs">
              {change.direction === 'positive' && '+'}
              {change.direction === 'negative' && '-'}
              {change.value}
            </span>
            <span className="text-xs opacity-60">vs last period</span>
          </div>
        )}
      </div>
    )
  }
)

MetricCard.displayName = 'MetricCard'