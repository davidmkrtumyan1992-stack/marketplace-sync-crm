import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  FileBarChart
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useProducts } from "@/hooks/use-products";
import { useOrders } from "@/hooks/use-orders";
import { useQuery } from "@tanstack/react-query";
import { Customer } from "@shared/schema";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const { data: products } = useProducts();
  const { data: orders } = useOrders();
  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });

  const totalProducts = products?.length || 0;
  const totalOrders = orders?.length || 0;
  const totalCustomers = customers?.length || 0;

  const navItems = [
    { href: "/", label: "Панель", icon: LayoutDashboard },
    { href: "/products", label: "Товары", icon: Package },
    { href: "/orders", label: "Заказы", icon: ShoppingCart },
    { href: "/customers", label: "Клиенты", icon: Users },
    { href: "/reports", label: "Отчёты", icon: FileBarChart },
    { href: "/settings", label: "Настройки", icon: Settings },
  ];

  const stats = [
    { icon: Package, value: totalProducts, label: "Товаров", color: "from-primary to-accent" },
    { icon: ShoppingCart, value: totalOrders, label: "Заказов", color: "from-accent to-primary" },
    { icon: Users, value: totalCustomers, label: "Клиентов", color: "from-primary/80 to-accent/80" },
  ];

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

        <div className="px-4 py-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 px-2">
            Обзор
          </p>
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div 
                key={stat.label}
                className="stat-card-premium flex items-center gap-4"
                data-testid={`sidebar-stat-${stat.label.toLowerCase()}`}
              >
                <div className={`icon-box icon-box-lg bg-gradient-to-br ${stat.color}`}>
                  <Icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <div className="flex-1">
                  <p className="stat-number text-3xl">{stat.value}</p>
                  <p className="stat-label text-xs mt-0.5">{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>

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
              <p className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</p>
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
            
            <div className="mt-6 space-y-3">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div 
                    key={stat.label}
                    className="stat-card-premium flex items-center gap-4"
                  >
                    <div className={`icon-box icon-box-lg bg-gradient-to-br ${stat.color}`}>
                      <Icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div>
                      <p className="stat-number text-3xl">{stat.value}</p>
                      <p className="stat-label text-xs">{stat.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
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
