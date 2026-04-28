import { Button } from "@/components/ui/button";
import { Package, LineChart, Globe, Zap, ArrowRight, CheckCircle } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      {/* Левая часть с контентом */}
      <div className="flex-1 flex flex-col justify-center p-8 lg:p-16 xl:p-24 relative overflow-hidden">
        {/* Декоративный фон */}
        <div className="absolute top-0 left-0 w-full h-full bg-grid-slate-50/[0.1] -z-10" />
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-50 pointer-events-none" />

        <div className="max-w-xl mx-auto lg:mx-0">
          <div className="flex items-center gap-2 text-blue-600 mb-8 font-semibold tracking-wider uppercase text-sm">
            <Package className="w-5 h-5" />
            <span>CloudERP</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
            Синхронизируй.<br />
            <span className="text-blue-600">Продавай больше.</span>
          </h1>
          
          <p className="text-lg text-slate-600 mb-8 leading-relaxed">
            Единая система управления для вашего e-commerce бизнеса. Автоматическая синхронизация остатков на Ozon, Wildberries и вашем складе в реальном времени.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mb-12">
            <Button size="lg" className="h-12 px-8 text-base shadow-xl shadow-blue-500/20" asChild>
              <a href="/login">
                Войти в систему
                <ArrowRight className="ml-2 w-4 h-4" />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base">
              Посмотреть демо
            </Button>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-slate-700 font-medium">Синхронизация с маркетплейсами в реальном времени</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-slate-700 font-medium">Автоматическая обработка заказов</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-slate-700 font-medium">Единая база клиентов</span>
            </div>
          </div>
        </div>
      </div>

      {/* Правая визуальная часть */}
      <div className="flex-1 bg-slate-900 p-8 lg:p-16 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-purple-600/20" />
        
        <div className="relative w-full max-w-lg aspect-square">
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-full blur-[100px] opacity-20 animate-pulse" />
          
          <div className="relative grid grid-cols-2 gap-4">
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 p-6 rounded-2xl shadow-2xl">
              <LineChart className="w-10 h-10 text-blue-400 mb-4" />
              <h3 className="text-slate-200 font-semibold mb-1">Аналитика</h3>
              <p className="text-slate-400 text-sm">Отслеживайте показатели по всем каналам</p>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 p-6 rounded-2xl shadow-2xl mt-8">
              <Globe className="w-10 h-10 text-purple-400 mb-4" />
              <h3 className="text-slate-200 font-semibold mb-1">Маркетплейсы</h3>
              <p className="text-slate-400 text-sm">Ozon и Wildberries в одном месте</p>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 p-6 rounded-2xl shadow-2xl -mt-8">
              <Zap className="w-10 h-10 text-amber-400 mb-4" />
              <h3 className="text-slate-200 font-semibold mb-1">Мгновенно</h3>
              <p className="text-slate-400 text-sm">Никогда не продавайте больше, чем есть</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
