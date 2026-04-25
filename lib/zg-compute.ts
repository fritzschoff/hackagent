export type InferenceResult = {
  text: string;
  attestationHash: string | null;
  model: string;
};

export async function reason(_args: {
  prompt: string;
  system?: string;
}): Promise<InferenceResult | null> {
  return null;
}
