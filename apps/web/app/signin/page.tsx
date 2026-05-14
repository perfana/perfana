'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { signInSchema, type SignInFormData } from '@/lib/validations'
import { env } from '@/lib/env'

// NOTE: The traditional email/password authentication form is kept for backwards
// compatibility but is not functional since auth-context only supports Keycloak.
// When USE_KEYCLOAK_AUTH=false, users should be directed to set up Keycloak instead.

export default function SignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, user } = useAuth()
  
  const successMessage = searchParams.get('message')
  
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError: setFormError,
  } = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
  })

  // Redirect if already signed in
  useEffect(() => {
    if (user) {
      const returnTo = sessionStorage.getItem('perfana_return_to')
      if (returnTo) {
        sessionStorage.removeItem('perfana_return_to')
        router.push(returnTo)
      } else {
        router.push('/')
      }
    }
  }, [user, router])

  // Traditional authentication is not supported - auth-context only supports Keycloak
  const onSubmit = async (_data: SignInFormData) => {
    setFormError('root', {
      message: 'Traditional authentication is not supported. Please enable Keycloak authentication or contact your administrator.'
    })
  }

  const handleKeycloakLogin = async () => {
    try {
      await login()
    } catch (err: unknown) {
      setFormError('root', {
        message: err.message || 'Keycloak login failed'
      })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md" variant="elevated">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-foreground">
            Sign in to Perfana
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Access your performance analysis dashboard
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3 [.dark_&]:bg-green-900/20 [.dark_&]:border-green-800">
              <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
            </div>
          )}

          {errors.root && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm text-destructive">{errors.root.message}</p>
            </div>
          )}

          {env.USE_KEYCLOAK_AUTH ? (
            // Keycloak authentication
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Sign in with your enterprise credentials
                </p>
                <Button
                  onClick={handleKeycloakLogin}
                  variant="primary"
                  size="lg"
                  className="w-full"
                >
                  Sign In with Keycloak
                </Button>
              </div>
            </div>
          ) : (
            // Traditional email/password authentication
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-4">
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
                    placeholder="Enter your password"
                    className="w-full"
                  />
                  {errors.password && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.password.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  isLoading={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>

        {!env.USE_KEYCLOAK_AUTH && (
          <CardFooter className="flex flex-col space-y-4">
            <div className="text-center space-y-2">
              <Link
                href="/forgot-password"
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
              >
                Forgot your password?
              </Link>

              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link
                  href="/signup"
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 font-medium"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}