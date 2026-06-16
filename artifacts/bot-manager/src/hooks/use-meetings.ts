import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMeetingRequests,
  updateMeetingRequest,
  suggestMeetingTime,
  getListMeetingRequestsQueryKey,
  type ListMeetingRequestsParams,
  type UpdateMeetingRequestBody
} from "@workspace/api-client-react";

export function useMeetingRequests(params?: ListMeetingRequestsParams) {
  return useQuery({
    queryKey: getListMeetingRequestsQueryKey(params),
    queryFn: () => listMeetingRequests(params),
  });
}

export function useUpdateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateMeetingRequestBody }) => 
      updateMeetingRequest(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
    },
  });
}

export function useSuggestTime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => suggestMeetingTime(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
    },
  });
}
