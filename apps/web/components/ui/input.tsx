'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'error' | 'success'
  inputSize?: 'sm' | 'base' | 'lg'
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ 
    className, 
    variant = 'default', 
    inputSize = 'base',
    leftIcon,
    rightIcon,
    type = 'text',
    ...props 
  }, ref) => {
    const baseClasses = 'input'
    
    const variantClasses = {
      default: '',
      error: 'input-error',
      success: 'input-success',
    }
    
    const sizeClasses = {
      sm: 'input-sm',
      base: '',
      lg: 'input-lg',
    }

    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {leftIcon}
            </div>
          )}
          <input
            type={type}
            className={cn(
              baseClasses,
              variantClasses[variant],
              sizeClasses[inputSize],
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            ref={ref}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {rightIcon}
            </div>
          )}
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[inputSize],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: 'default' | 'error' | 'success'
  inputSize?: 'sm' | 'base' | 'lg'
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = 'default', inputSize = 'base', ...props }, ref) => {
    const baseClasses = 'input'
    
    const variantClasses = {
      default: '',
      error: 'input-error',
      success: 'input-success',
    }
    
    const sizeClasses = {
      sm: 'input-sm',
      base: '',
      lg: 'input-lg',
    }

    return (
      <textarea
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[inputSize],
          'min-h-[80px] resize-y',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'