import { useQuery } from "@tanstack/react-query";
import type { RoleName } from "@shared/schema";

interface UserRoleResponse {
  role: RoleName;
}

export function useRole() {
  const { data, isLoading } = useQuery<UserRoleResponse>({
    queryKey: ["/api/user-role"],
    staleTime: 1000 * 60 * 5,
  });

  const role: RoleName = data?.role || "owner";

  const canAccessProducts = role === "owner" || role === "administrator";
  const canAccessOrders = role === "owner" || role === "administrator";
  const canAccessIntake = role === "owner" || role === "administrator";
  const canAccessCustomers = role === "owner" || role === "administrator";
  const canAccessReports = role === "owner" || role === "accountant";
  const canAccessSettings = role === "owner";
  const canSeePurchasePrice = role === "owner" || role === "accountant";
  const canSeePnL = role === "owner" || role === "accountant";
  const canAccessDashboard = true;

  return {
    role,
    isLoading,
    canAccessProducts,
    canAccessOrders,
    canAccessIntake,
    canAccessCustomers,
    canAccessReports,
    canAccessSettings,
    canSeePurchasePrice,
    canSeePnL,
    canAccessDashboard,
  };
}
