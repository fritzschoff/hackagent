# contracts/

Standalone Foundry workspace for the ERC-8004 reference deployment.

Excluded from the Vercel build via `.vercelignore`. Deploys are run locally with
`forge create` (or `forge script`) targeting Sepolia.

## Quickstart

```bash
forge install foundry-rs/forge-std
forge build
forge test
```

## Deploy (Sepolia)

```bash
forge create src/IdentityRegistry.sol:IdentityRegistry \
  --rpc-url $SEPOLIA_RPC_URL --private-key $AGENT_PK
forge create src/ReputationRegistry.sol:ReputationRegistry \
  --rpc-url $SEPOLIA_RPC_URL --private-key $AGENT_PK \
  --constructor-args <identity_registry_address>
forge create src/ValidationRegistry.sol:ValidationRegistry \
  --rpc-url $SEPOLIA_RPC_URL --private-key $AGENT_PK \
  --constructor-args <identity_registry_address>
```

After deploy, paste the addresses into Vercel Edge Config (`addresses.sepolia`).

The contracts are minimal hackathon references and should not be reused
verbatim in production.
