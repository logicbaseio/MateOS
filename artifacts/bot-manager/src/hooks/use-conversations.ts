import { useQuery } from "@tanstack/react-query";
import {
  listConversations,
  getListConversationsQueryKey,
  type ListConversationsParams
} from "@workspace/api-client-react";

export function useConversations(params?: ListConversationsParams) {
  return useQuery({
    queryKey: getListConversationsQueryKey(params),
    queryFn: () => listConversations(params),
  });
}
