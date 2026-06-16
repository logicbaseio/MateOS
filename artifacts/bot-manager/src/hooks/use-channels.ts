import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTeamChannels,
  createTeamChannel,
  updateTeamChannel,
  deleteTeamChannel,
  getListTeamChannelsQueryKey,
  type CreateTeamChannelBody,
  type UpdateTeamChannelBody
} from "@workspace/api-client-react";

export function useTeamChannels() {
  return useQuery({
    queryKey: getListTeamChannelsQueryKey(),
    queryFn: () => listTeamChannels(),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTeamChannelBody) => createTeamChannel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListTeamChannelsQueryKey() });
    },
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateTeamChannelBody }) => 
      updateTeamChannel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListTeamChannelsQueryKey() });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTeamChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListTeamChannelsQueryKey() });
    },
  });
}
