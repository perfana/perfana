import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { SidebarProvider } from '@/contexts/sidebar-context';
import { AuthProvider } from '@/contexts/auth-context';
import { AuthLayout } from '@/components/layout/auth-layout';
import { MUIThemeProvider } from '@/components/providers/theme-provider';
import { OrganizationProvider } from '@/lib/contexts/organization-context';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Perfana - Performance Analysis Platform',
  description: 'Automated performance testing analysis and observability',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runtime environment is loaded via /api/config in auth-context.tsx */}
      </head>
      <body className={inter.className}>
        <MUIThemeProvider>
          <Providers>
            <AuthProvider>
              <OrganizationProvider>
                <SidebarProvider>
                  <AuthLayout>
                    {children}
                  </AuthLayout>
                </SidebarProvider>
              </OrganizationProvider>
            </AuthProvider>
          </Providers>
        </MUIThemeProvider>
      </body>
    </html>
  );
}