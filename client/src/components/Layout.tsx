import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  FileBarChart,
  ScanLine,
  Shield,
  Radio
} from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useQuery } from "@tanstack/react-query";
import { InventorySyncSetting } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  accountant: "Бухгалтер",
  administrator: "Администратор",
};

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { role, canAccessProducts, canAccessOrders, canAccessIntake, canAccessCustomers, canAccessReports, canAccessSettings } = useRole();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const { data: syncSettings } = useQuery<InventorySyncSetting>({
    queryKey: ["/api/inventory-sync/settings"],
  });
  const isDemoMode = syncSettings?.demoMode ?? false;

  const allNavItems = [
    { href: "/", label: "Панель", icon: LayoutDashboard, visible: true },
    { href: "/products", label: "Товары", icon: Package, visible: canAccessProducts },
    { href: "/orders", label: "Заказы", icon: ShoppingCart, visible: canAccessOrders },
    { href: "/customers", label: "Клиенты", icon: Users, visible: canAccessCustomers },
    { href: "/intake", label: "Приёмка", icon: ScanLine, visible: canAccessIntake },
    { href: "/reports", label: "Отчёты", icon: FileBarChart, visible: canAccessReports },
    { href: "/settings", label: "Настройки", icon: Settings, visible: canAccessSettings },
  ];

  const navItems = useMemo(() => allNavItems.filter(item => item.visible), [canAccessProducts, canAccessOrders, canAccessIntake, canAccessCustomers, canAccessReports, canAccessSettings]);

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex flex-col w-72 bg-sidebar text-sidebar-foreground" data-testid="sidebar">
        <div className="p-6 pb-4">
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            CloudERP
          </h1>
          <p className="text-xs text-sidebar-foreground/60 mt-1">Учёт товаров и продаж</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href} 
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                  ${isActive 
                    ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25" 
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10"}
                `}
                data-testid={`nav-${item.href.replace('/', '') || 'dashboard'}`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-foreground/10">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-10 w-10 ring-2 ring-primary/30">
              <AvatarImage src={user?.profileImageUrl || undefined} />
              <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground font-semibold">
                {user?.firstName?.charAt(0) || "П"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid="badge-role">
                  <Shield className="w-2.5 h-2.5 mr-0.5" />
                  {ROLE_LABELS[role] || role}
                </Badge>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => logout()} 
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-xl"
              data-testid="button-logout"
            >
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {isDemoMode && (
          <div
            className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 flex items-center justify-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400"
            data-testid="banner-demo-mode"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Работает в демо-режиме</span>
          </div>
        )}
        <header className="h-16 bg-card/80 backdrop-blur-xl border-b border-border/50 flex items-center justify-between px-4 md:px-8 sticky top-0 z-50">
          <div className="lg:hidden">
            <span className="font-bold text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              CloudERP
            </span>
          </div>
          
          <div className="hidden lg:flex items-center gap-2 text-sm text-muted-foreground">
            <span>Добро пожаловать,</span>
            <span className="font-semibold text-foreground">{user?.firstName}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="lg:hidden">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
                data-testid="button-mobile-menu"
                className="rounded-xl"
              >
                {isMobileMenuOpen ? <X /> : <Menu />}
              </Button>
            </div>
          </div>
        </header>

        {isMobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-sidebar pt-16 px-4 pb-4">
            <nav className="space-y-2 mt-4">
              {navItems.map((item) => (
                <Link 
                  key={item.href} 
                  href={item.href} 
                  onClick={() => setIsMobileMenuOpen(false)} 
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium
                    ${location === item.href 
                      ? "bg-gradient-to-r from-primary to-accent text-primary-foreground" 
                      : "text-sidebar-foreground/70"}
                  `}
                >
                  <item.icon size={20} />
                  {item.label}
                </Link>
              ))}
              <button 
                onClick={() => logout()} 
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-destructive"
                data-testid="button-mobile-logout"
              >
                <LogOut size={20} />
                Выйти
              </button>
            </nav>
            
          </div>
        )}

        <main className="flex-1 p-4 md:p-8 overflow-y-auto premium-gradient-subtle">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
