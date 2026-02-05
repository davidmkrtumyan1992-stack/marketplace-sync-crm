import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 text-center">
          <div className="flex items-center justify-center mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 - Страница не найдена</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Запрашиваемая страница не существует или была перемещена.
          </p>

          <Button asChild className="mt-6">
            <Link href="/">
              <Home className="w-4 h-4 mr-2" />
              На главную
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
