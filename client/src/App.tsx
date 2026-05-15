import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueries } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Orders from "@/pages/Orders";
import Customers from "@/pages/Customers";
import Settings from "@/pages/Settings";
import Reports from "@/pages/Reports";
import Intake from "@/pages/Intake";
import Writeoff from "@/pages/Writeoff";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { ShieldAlert, Database, Shield, BarChart3, Package } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { getQueryFn } from "./lib/queryClient";

function SplashScreen({ progress, label }: { progress: number; label: string }) {
  const icons = [Database, Shield, Package, BarChart3];
  const iconIdx = progress < 30 ? 0 : progress < 70 ? 1 : progress < 100 ? 2 : 3;
  const Icon = icons[iconIdx];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-900" data-testid="splash-screen">
      <div className={`flex flex-col items-center gap-6 transition-opacity duration-500 ${progress >= 100 ? "opacity-0" : "opacity-100"}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">CloudERP</h1>
        </div>
        <div className="w-72 space-y-3">
          <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlobalDataPreloader({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [syncTriggered, setSyncTriggered] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Prefetch data in background — не блокируем UI
  useQueries({
    queries: [
      {
        queryKey: ["/api/orders"],
        queryFn: getQueryFn({ on401: "returnNull" }),
        enabled: !!user,
      },
      {
        queryKey: ["/api/stores"],
        queryFn: getQueryFn({ on401: "returnNull" }),
        enabled: !!user,
      },
      {
        queryKey: ["/api/products"],
        queryFn: getQueryFn({ on401: "returnNull" }),
        enabled: !!user,
      },
    ],
  });

  useEffect(() => {
    if (user && !syncTriggered) {
      setSyncTriggered(true);
      fetch("/api/sync/trigger", { method: "POST", credentials: "include" }).catch(() => {});
    }
  }, [user, syncTriggered]);

  // Показываем splash только пока проверяется auth — данные грузятся в фоне
  useEffect(() => {
    if (!authLoading && showSplash) {
      const timer = setTimeout(() => setShowSplash(false), 400);
      return () => clearTimeout(timer);
    }
  }, [authLoading, showSplash]);

  if (showSplash && authLoading) {
    return <SplashScreen progress={authLoading ? 50 : 100} label="Подключение к серверу..." />;
  }

  return <>{children}</>;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType; path?: string }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <SplashScreen progress={30} label="Проверка авторизации..." />;
  }

  if (!user) {
    return <Login />;
  }

  return <Component />;
}

function RoleGuard({ component: Component, allowed }: { component: React.ComponentType; allowed: boolean; path?: string }) {
  const { user, isLoading } = useAuth();
  const { isLoading: roleLoading } = useRole();

  if (isLoading || roleLoading) {
    return <SplashScreen progress={40} label="Проверка авторизации..." />;
  }

  if (!user) {
    return <Login />;
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
      <Route path="/login" component={Login} />
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/products" component={() => <RoleGuard component={Products} allowed={canAccessProducts} />} />
      <Route path="/orders" component={() => <RoleGuard component={Orders} allowed={canAccessOrders} />} />
      <Route path="/customers" component={() => <RoleGuard component={Customers} allowed={canAccessCustomers} />} />
      <Route path="/reports" component={() => <RoleGuard component={Reports} allowed={canAccessReports} />} />
      <Route path="/settings" component={() => <RoleGuard component={Settings} allowed={canAccessSettings} />} />
      <Route path="/intake" component={() => <RoleGuard component={Intake} allowed={canAccessIntake} />} />
      <Route path="/writeoff" component={() => <RoleGuard component={Writeoff} allowed={canAccessIntake} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <GlobalDataPreloader>
          <Router />
        </GlobalDataPreloader>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
