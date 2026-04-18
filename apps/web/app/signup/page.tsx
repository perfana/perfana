'use client'

import { authenticatedFetch } from '@/lib/api';

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { signUpSchema, type SignUpFormData } from '@/lib/validations'

export default function SignUpPage() {
  const router = useRouter()
  const { user } = useAuth()
  
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError: setFormError,
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
  })

  // Redirect if already signed in
  useEffect(() => {
    if (user) {
      router.push('/')
    }
  }, [user, router])

  const onSubmit = async (data: SignUpFormData) => {
    try {
      const metadata = data.firstName || data.lastName ? { 
        firstName: data.firstName, 
        lastName: data.lastName 
      } : undefined
      
      const response = await authenticatedFetch(`/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: data.email, 
          password: data.password, 
          metadata 
        }),
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.message || 'Sign up failed')
      }

      // Redirect to sign in page with success message
      router.push('/signin?message=Account created successfully. Please sign in.')
    } catch (err: unknown) {
      setFormError('root', {
        message: err.message || 'An error occurred during sign up'
      })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md" variant="elevated">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-foreground">
            Create your account
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Join Perfana to start analyzing your performance data
          </p>
        </CardHeader>
        
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {errors.root && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                <p className="text-sm text-destructive">{errors.root.message}</p>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1">
                  First Name
                </label>
                <Input
                  id="firstName"
                  type="text"
                  {...register('firstName')}
                  placeholder="John"
                  className="w-full"
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.firstName.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1">
                  Last Name
                </label>
                <Input
                  id="lastName"
                  type="text"
                  {...register('lastName')}
                  placeholder="Doe"
                  className="w-full"
                />
                {errors.lastName && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.lastName.message}</p>
                )}
              </div>
            </div>
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                {...register('email')}
                placeholder="Enter your email"
                className="w-full"
              />
              {errors.email && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.email.message}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <Input
                id="password"
                type="password"
                {...register('password')}
                placeholder="Enter your password (min 6 characters)"
                className="w-full"
              />
              {errors.password && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.password.message}</p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Password must be at least 6 characters long
              </p>
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col space-y-4">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Creating account...' : 'Sign Up'}
            </Button>
            
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link 
                href="/signin" 
                className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-medium"
              >
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}