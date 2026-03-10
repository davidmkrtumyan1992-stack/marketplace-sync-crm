import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
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
import { Loader2, ShieldAlert, Database, Shield, BarChart3 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";

function SplashScreen({ stage }: { stage: "connecting" | "auth" | "data" | "ready" }) {
  const stages = [
    { key: "connecting", label: "Подключение к серверу...", icon: Database, progress: 20 },
    { key: "auth", label: "Проверка авторизации...", icon: Shield, progress: 55 },
    { key: "data", label: "Загрузка данных...", icon: BarChart3, progress: 85 },
    { key: "ready", label: "Готово", icon: BarChart3, progress: 100 },
  ];
  const current = stages.find(s => s.key === stage) || stages[0];
  const StageIcon = current.icon;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-900" data-testid="splash-screen">
      <div className={`flex flex-col items-center gap-6 transition-opacity duration-500 ${stage === "ready" ? "opacity-0" : "opacity-100"}`}>
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
              style={{ width: `${current.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <StageIcon className="w-4 h-4" />
            <span>{current.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType; path?: string }) {
  const { user, isLoading } = useAuth();
  const [splashStage, setSplashStage] = useState<"connecting" | "auth" | "data" | "ready">("connecting");
  const [showSplash, setShowSplash] = useState(true);
  const [syncTriggered, setSyncTriggered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSplashStage("auth"), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setSplashStage("data");
      const timer = setTimeout(() => {
        setSplashStage("ready");
        setTimeout(() => setShowSplash(false), 500);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (user && !syncTriggered) {
      setSyncTriggered(true);
      fetch("/api/sync/trigger", { method: "POST", credentials: "include" }).catch(() => {});
    }
  }, [user, syncTriggered]);

  if (showSplash && isLoading) {
    return <SplashScreen stage={splashStage} />;
  }

  if (showSplash && !isLoading && splashStage !== "ready") {
    return <SplashScreen stage={splashStage} />;
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
    return <SplashScreen stage="auth" />;
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
