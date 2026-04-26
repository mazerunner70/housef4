import { getFinanceRepository } from '@housef4/db';

export async function getAccountsPayload(userId: string): Promise<{
  accounts: {
    id: string;
    name: string;
    created_at: number;
  }[];
}> {
  const accounts = await getFinanceRepository().listAccounts(userId);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      created_at: a.created_at,
    })),
  };
}
