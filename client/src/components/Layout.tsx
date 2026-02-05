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
  X
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Панель управления", icon: LayoutDashboard },
    { href: "/products", label: "Товары", icon: Package },
    { href: "/orders", label: "Заказы", icon: ShoppingCart },
    { href: "/customers", label: "Клиенты", icon: Users },
    { href: "/settings", label: "Маркетплейсы", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white border-r border-slate-800">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-blue-400">CloudERP</h1>
          <p className="text-xs text-slate-400 mt-1">Учёт товаров и продаж</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-800"}
              `}>
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-8 w-8 border border-slate-700">
              <AvatarImage src={user?.profileImageUrl} />
              <AvatarFallback>{user?.firstName?.charAt(0) || "П"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => logout()} className="text-slate-400 hover:text-white hover:bg-slate-800">
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-16 bg-white border-b flex items-center justify-between px-4 sticky top-0 z-50">
          <span className="font-bold text-lg text-slate-900">CloudERP</span>
          <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X /> : <Menu />}
          </Button>
        </header>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-slate-900 pt-16 px-4 pb-4">
            <nav className="space-y-2 mt-4">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setIsMobileMenuOpen(false)} className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium
                  ${location === item.href ? "bg-blue-600 text-white" : "text-slate-400"}
                `}>
                  <item.icon size={20} />
                  {item.label}
                </Link>
              ))}
              <button onClick={() => logout()} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-red-400">
                <LogOut size={20} />
                Выйти
              </button>
            </nav>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
