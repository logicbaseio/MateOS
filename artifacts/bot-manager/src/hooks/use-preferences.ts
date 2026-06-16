import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getPreferences, 
  updatePreferences, 
  getGetPreferencesQueryKey,
  type UpdatePreferencesBody
} from "@workspace/api-client-react";

export function useBossPreferences() {
  return useQuery({
    queryKey: getGetPreferencesQueryKey(),
    queryFn: () => getPreferences(),
  });
}

export function useUpdateBossPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePreferencesBody) => updatePreferences(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
    },
  });
}

export function useBotName(): string {
  const { data } = useBossPreferences();
  return (data as any)?.botName || "Mate";
}

export function useBossName(): string {
  const { data } = useBossPreferences();
  return data?.bossName || "Owner";
}
