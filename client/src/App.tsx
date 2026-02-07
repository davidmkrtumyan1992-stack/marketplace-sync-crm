import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Orders from "@/pages/Orders";
import Customers from "@/pages/Customers";
import Settings from "@/pages/Settings";
import Reports from "@/pages/Reports";
import Intake from "@/pages/Intake";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Loader2, ShieldAlert } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";

function ProtectedRoute({ component: Component }: { component: React.ComponentType; path?: string }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Landing />;
  }

  return <Component />;
}

function RoleGuard({ component: Component, allowed }: { component: React.ComponentType; allowed: boolean; path?: string }) {
  const { user, isLoading } = useAuth();
  const { isLoading: roleLoading } = useRole();

  if (isLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Landing />;
  }

  if (!allowed) {
    return (
      <Layout>
        <Card className="max-w-md mx-auto mt-20" data-testid="card-access-denied">
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <ShieldAlert className="w-12 h-12 text-destructive" />
            <p className="text-lg font-semibold">Доступ запрещён</p>
            <p className="text-sm text-muted-foreground text-center">
              У вашей роли нет доступа к этому разделу
            </p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return <Component />;
}

function Router() {
  const { canAccessProducts, canAccessOrders, canAccessIntake, canAccessCustomers, canAccessReports, canAccessSettings } = useRole();

  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/products" component={() => <RoleGuard component={Products} allowed={canAccessProducts} />} />
      <Route path="/orders" component={() => <RoleGuard component={Orders} allowed={canAccessOrders} />} />
      <Route path="/customers" component={() => <RoleGuard component={Customers} allowed={canAccessCustomers} />} />
      <Route path="/reports" component={() => <RoleGuard component={Reports} allowed={canAccessReports} />} />
      <Route path="/settings" component={() => <RoleGuard component={Settings} allowed={canAccessSettings} />} />
      <Route path="/intake" component={() => <RoleGuard component={Intake} allowed={canAccessIntake} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
