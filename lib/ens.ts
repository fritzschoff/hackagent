export const PARENT_ENS = "agentlab.eth";
export const AGENT_SUBNAME = "tradewise";
export const AGENT_ENS = `${AGENT_SUBNAME}.${PARENT_ENS}`;

export async function resolveAgentEns(): Promise<{
  name: string;
  address: `0x${string}` | null;
  agentCardUrl: string | null;
  registrationRecord: string | null;
}> {
  return {
    name: AGENT_ENS,
    address: null,
    agentCardUrl: null,
    registrationRecord: null,
  };
}

export async function setEnsTextRecord(_args: {
  key: string;
  value: string;
}): Promise<{ txHash: `0x${string}` } | null> {
  return null;
}

export async function refreshHeartbeat(): Promise<void> {
  return;
}
