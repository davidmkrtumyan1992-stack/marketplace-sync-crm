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
  MinusCircle,
  Shield,
  Radio,
  PanelLeft,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useQuery } from "@tanstack/react-query";
import { InventorySyncSetting } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

function getCookieSidebarCollapsed(): boolean {
  const match = document.cookie.match(/(?:^|;\s*)sidebarCollapsed=([^;]*)/);
  return match ? match[1] === 'true' : false;
}
function setCookieSidebarCollapsed(val: boolean) {
  document.cookie = `sidebarCollapsed=${val};path=/;max-age=31536000;SameSite=Lax`;
}

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => getCookieSidebarCollapsed());

  const toggleSidebar = () => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    setCookieSidebarCollapsed(next);
  };
  
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
    { href: "/writeoff", label: "Списание", icon: MinusCircle, visible: canAccessIntake },
    { href: "/reports", label: "Отчёты", icon: FileBarChart, visible: canAccessReports },
    { href: "/settings", label: "Настройки", icon: Settings, visible: canAccessSettings },
  ];

  const navItems = useMemo(() => allNavItems.filter(item => item.visible), [canAccessProducts, canAccessOrders, canAccessIntake, canAccessCustomers, canAccessReports, canAccessSettings]);

  return (
    <div className="min-h-screen bg-background flex">
      <aside className={`hidden lg:flex flex-col transition-all duration-300 bg-sidebar text-sidebar-foreground overflow-hidden flex-shrink-0 ${isSidebarCollapsed ? 'w-16' : 'w-72'}`} data-testid="sidebar">
        {/* Logo + toggle */}
        <div className={`flex items-center border-b border-sidebar-foreground/10 h-14 flex-shrink-0 ${isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-5'}`}>
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent leading-tight">
                CloudERP
              </h1>
              <p className="text-[10px] text-sidebar-foreground/60 leading-none">Учёт товаров и продаж</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-xl h-9 w-9 flex-shrink-0"
            title={isSidebarCollapsed ? "Открыть меню" : "Свернуть меню"}
          >
            <PanelLeft size={20} />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                  ${isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'}
                  ${isActive
                    ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10"}
                `}
                data-testid={`nav-${item.href.replace('/', '') || 'dashboard'}`}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <Icon size={20} className="flex-shrink-0" />
                {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User profile */}
        <div className="border-t border-sidebar-foreground/10 p-2">
          {isSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <Avatar className="h-8 w-8 ring-2 ring-primary/30">
                <AvatarImage src={user?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground font-semibold text-xs">
                  {user?.firstName?.charAt(0) || "П"}
                </AvatarFallback>
              </Avatar>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout()}
                className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-xl h-8 w-8"
                title="Выйти"
                data-testid="button-logout"
              >
                <LogOut size={16} />
              </Button>
            </div>
          ) : (
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
          )}
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
        <header className="h-14 bg-card/90 backdrop-blur-xl border-b border-border/50 flex items-center justify-between px-4 md:px-8 sticky top-0 z-50">
          <div className="lg:hidden">
            <span className="font-bold text-lg bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
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
                {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </Button>
            </div>
          </div>
        </header>

        {isMobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-sidebar pt-14 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <nav className="space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`
                      flex items-center gap-4 px-4 py-3.5 rounded-2xl text-base font-medium transition-all
                      ${location === item.href
                        ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg"
                        : "text-sidebar-foreground/70 active:bg-sidebar-foreground/10"}
                    `}
                  >
                    <item.icon size={22} />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="px-4 pb-8 border-t border-sidebar-foreground/10 pt-4">
              <div className="flex items-center gap-3 px-4 py-3 mb-3">
                <Avatar className="h-10 w-10 ring-2 ring-primary/30">
                  <AvatarImage src={user?.profileImageUrl || undefined} />
                  <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground font-semibold">
                    {user?.firstName?.charAt(0) || "П"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-sidebar-foreground">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-sidebar-foreground/50">{ROLE_LABELS[role] || role}</p>
                </div>
              </div>
              <button
                onClick={() => logout()}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-base font-medium text-destructive active:bg-destructive/10"
                data-testid="button-mobile-logout"
              >
                <LogOut size={22} />
                Выйти
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden premium-gradient-subtle pb-20 lg:pb-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border/50 flex items-stretch" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {[
            { href: "/", label: "Главная", icon: LayoutDashboard, visible: true },
            { href: "/orders", label: "Заказы", icon: ShoppingCart, visible: canAccessOrders },
            { href: "/products", label: "Товары", icon: Package, visible: canAccessProducts },
            { href: "/reports", label: "Отчёты", icon: FileBarChart, visible: canAccessReports },
          ].filter(i => i.visible).map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                <span className={`text-[10px] font-medium ${isActive ? "text-primary" : ""}`}>{item.label}</span>
                {isActive && <span className="absolute bottom-0 w-8 h-0.5 bg-primary rounded-full" />}
              </Link>
            );
          })}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${
              isMobileMenuOpen ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Menu size={22} strokeWidth={isMobileMenuOpen ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium">Ещё</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
