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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Панель", icon: LayoutDashboard },
    { href: "/products", label: "Товары", icon: Package },
    { href: "/orders", label: "Заказы", icon: ShoppingCart },
    { href: "/customers", label: "Клиенты", icon: Users },
    { href: "/reports", label: "Отчёты", icon: FileBarChart },
    { href: "/settings", label: "Настройки", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex flex-col w-72 bg-sidebar text-sidebar-foreground" data-testid="sidebar">
        <div className="p-6 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-sidebar-accent">CloudERP</h1>
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
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                  ${isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-lg" 
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
            <Avatar className="h-10 w-10 border-2 border-sidebar-accent/30">
              <AvatarImage src={user?.profileImageUrl || undefined} />
              <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground font-semibold">
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
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10"
              data-testid="button-logout"
            >
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-16 bg-card border-b border-border flex items-center justify-between px-4 sticky top-0 z-50">
          <span className="font-bold text-xl text-primary">CloudERP</span>
          <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} data-testid="button-mobile-menu">
            {isMobileMenuOpen ? <X /> : <Menu />}
          </Button>
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
                      ? "bg-sidebar-accent text-sidebar-accent-foreground" 
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

        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
