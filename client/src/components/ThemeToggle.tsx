import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

function getCookieTheme(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)theme=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookieTheme(theme: string) {
  document.cookie = `theme=${encodeURIComponent(theme)};path=/;max-age=31536000;SameSite=Lax`;
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return true;
  });

  useEffect(() => {
    const saved = getCookieTheme();
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    }
  }, []);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    if (newIsDark) {
      document.documentElement.classList.add('dark');
      setCookieTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      setCookieTheme('light');
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative h-10 w-10 rounded-xl hover:bg-primary/10 transition-all duration-300"
      data-testid="button-theme-toggle"
    >
      <Sun className={`h-5 w-5 transition-all duration-300 ${isDark ? 'opacity-0 scale-0 rotate-90' : 'opacity-100 scale-100 rotate-0'} absolute`} />
      <Moon className={`h-5 w-5 transition-all duration-300 ${isDark ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-0 -rotate-90'} absolute`} />
      <span className="sr-only">Сменить тему</span>
    </Button>
  );
}
