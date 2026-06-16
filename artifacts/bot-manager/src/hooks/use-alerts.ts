import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAmazonAlerts,
  updateAmazonAlert,
  processIncomingEmail,
  getListAmazonAlertsQueryKey,
  type ListAmazonAlertsParams,
  type UpdateAmazonAlertBody,
  type IncomingEmailBody
} from "@workspace/api-client-react";

export function useAmazonAlerts(params?: ListAmazonAlertsParams) {
  return useQuery({
    queryKey: getListAmazonAlertsQueryKey(params),
    queryFn: () => listAmazonAlerts(params),
  });
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateAmazonAlertBody }) => 
      updateAmazonAlert(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/amazon-alerts"] });
    },
  });
}

export function useSimulateEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IncomingEmailBody) => processIncomingEmail(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/amazon-alerts"] });
    },
  });
}
