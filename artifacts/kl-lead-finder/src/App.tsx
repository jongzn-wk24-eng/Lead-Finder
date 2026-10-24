import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DataModeBoundary } from '@/components/data-mode';
import { AppShell, AuthGate } from '@/components/shell';
import { Surface, EmptyState } from '@/components/kit';
import DataCenterPage from '@/pages/data-center';
import LeadsPage from '@/pages/leads';
import CompanyPage from '@/pages/company';
import ActivityPage from '@/pages/activity';
import SettingsPage from '@/pages/settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0, gcTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 } } });

function NotFound() {
  return <Surface><EmptyState text="This page does not exist." action={<Link href="/" className="text-sm text-primary hover:underline">Go to Data Center</Link>} /></Surface>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>
    <AuthGate><DataModeBoundary><AppShell>
      <Switch>
        <Route path="/" component={DataCenterPage} />
        <Route path="/leads" component={LeadsPage} />
        <Route path="/companies/:id" component={CompanyPage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell></DataModeBoundary></AuthGate>
  </ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
