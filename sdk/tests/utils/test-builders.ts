import { AddressUtil, MathUtil, PDA, Percentage } from "@orca-so/common-sdk";
import { AnchorProvider } from "@project-serum/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { createAndMintToAssociatedTokenAccount, createMint } from ".";
import {
  increaseLiquidityQuoteByInputToken,
  InitConfigParams,
  InitFeeTierParams,
  InitPoolParams,
  InitTickArrayParams,
  OpenPositionParams,
  OpenBundledPositionParams,
  PDAUtil,
  PoolUtil,
  PriceMath,
  Whirlpool,
} from "../../src";
import { WhirlpoolContext } from "../../src/context";

export interface TestWhirlpoolsConfigKeypairs {
  feeAuthorityKeypair: Keypair;
  collectProtocolFeesAuthorityKeypair: Keypair;
  rewardEmissionsSuperAuthorityKeypair: Keypair;
}

export interface TestConfigParams {
  configInitInfo: InitConfigParams;
  configKeypairs: TestWhirlpoolsConfigKeypairs;
}

export const generateDefaultConfigParams = (
  context: WhirlpoolContext,
  funder?: PublicKey
): TestConfigParams => {
  const configKeypairs: TestWhirlpoolsConfigKeypairs = {
    feeAuthorityKeypair: Keypair.generate(),
    collectProtocolFeesAuthorityKeypair: Keypair.generate(),
    rewardEmissionsSuperAuthorityKeypair: Keypair.generate(),
  };
  const configInitInfo = {
    whirlpoolsConfigKeypair: Keypair.generate(),
    feeAuthority: configKeypairs.feeAuthorityKeypair.publicKey,
    collectProtocolFeesAuthority: configKeypairs.collectProtocolFeesAuthorityKeypair.publicKey,
    rewardEmissionsSuperAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
    defaultProtocolFeeRate: 300,
    funder: funder || context.wallet.publicKey,
  };
  return { configInitInfo, configKeypairs };
};

export const createInOrderMints = async (context: WhirlpoolContext, reuseTokenA?: PublicKey, reuseTokenB?: PublicKey) => {
  const provider = context.provider;
  const tokenXMintPubKey = reuseTokenA ?? (await createMint(provider));

  let ordered;
  if(reuseTokenB) {
    const tokenYMintPubKey = reuseTokenB
    ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
  } else {
    // ensure reuseTokenA is the first mint if reuseTokenA is provided
    do {
      const tokenYMintPubKey = await createMint(provider);
      ordered = PoolUtil.orderMints(tokenXMintPubKey, tokenYMintPubKey).map(AddressUtil.toPubKey);
    } while (!!reuseTokenA && !ordered[0].equals(reuseTokenA));
  }
  return ordered;
};

export const generateDefaultInitPoolParams = async (
  context: WhirlpoolContext,
  configKey: PublicKey,
  feeTierKey: PublicKey,
  tickSpacing: number,
  initSqrtPrice = MathUtil.toX64(new Decimal(5)),
  funder?: PublicKey,
  reuseTokenA?: PublicKey,
  reuseTokenB?: PublicKey
): Promise<InitPoolParams> => {
  const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMints(context, reuseTokenA, reuseTokenB);

  const whirlpoolPda = PDAUtil.getWhirlpool(
    context.program.programId,
    configKey,
    tokenAMintPubKey,
    tokenBMintPubKey,
    tickSpacing
  );

  return {
    initSqrtPrice,
    whirlpoolsConfig: configKey,
    tokenMintA: tokenAMintPubKey,
    tokenMintB: tokenBMintPubKey,
    whirlpoolPda,
    tokenVaultAKeypair: Keypair.generate(),
    tokenVaultBKeypair: Keypair.generate(),
    feeTierKey,
    tickSpacing,
    funder: funder || context.wallet.publicKey,
  };
};

export const generateDefaultInitFeeTierParams = (
  context: WhirlpoolContext,
  whirlpoolsConfigKey: PublicKey,
  whirlpoolFeeAuthority: PublicKey,
  tickSpacing: number,
  defaultFeeRate: number,
  funder?: PublicKey
): InitFeeTierParams => {
  const feeTierPda = PDAUtil.getFeeTier(
    context.program.programId,
    whirlpoolsConfigKey,
    tickSpacing
  );
  return {
    feeTierPda,
    whirlpoolsConfig: whirlpoolsConfigKey,
    tickSpacing,
    defaultFeeRate,
    feeAuthority: whirlpoolFeeAuthority,
    funder: funder || context.wallet.publicKey,
  };
};

export const generateDefaultInitTickArrayParams = (
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  startTick: number,
  funder?: PublicKey
): InitTickArrayParams => {
  const tickArrayPda = PDAUtil.getTickArray(context.program.programId, whirlpool, startTick);

  return {
    whirlpool,
    tickArrayPda: tickArrayPda,
    startTick,
    funder: funder || context.wallet.publicKey,
  };
};

export async function generateDefaultOpenPositionParams(
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey,
  funder?: PublicKey
): Promise<{ params: Required<OpenPositionParams & { metadataPda: PDA }>; mint: Keypair }> {
  const positionMintKeypair = Keypair.generate();
  const positionPda = PDAUtil.getPosition(context.program.programId, positionMintKeypair.publicKey);

  const metadataPda = PDAUtil.getPositionMetadata(positionMintKeypair.publicKey);

  const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    positionMintKeypair.publicKey,
    owner
  );

  const params: Required<OpenPositionParams & { metadataPda: PDA }> = {
    funder: funder || context.wallet.publicKey,
    owner: owner,
    positionPda,
    metadataPda,
    positionMintAddress: positionMintKeypair.publicKey,
    positionTokenAccount: positionTokenAccountAddress,
    whirlpool: whirlpool,
    tickLowerIndex,
    tickUpperIndex,
  };
  return {
    params,
    mint: positionMintKeypair,
  };
}

export async function mintTokensToTestAccount(
  provider: AnchorProvider,
  tokenAMint: PublicKey,
  tokenMintForA: number,
  tokenBMint: PublicKey,
  tokenMintForB: number,
  destinationWallet?: PublicKey
) {
  const userTokenAAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenAMint,
    tokenMintForA,
    destinationWallet
  );
  const userTokenBAccount = await createAndMintToAssociatedTokenAccount(
    provider,
    tokenBMint,
    tokenMintForB,
    destinationWallet
  );

  return [userTokenAAccount, userTokenBAccount];
}

export async function initPosition(
  ctx: WhirlpoolContext,
  pool: Whirlpool,
  lowerPrice: Decimal,
  upperPrice: Decimal,
  inputTokenMint: PublicKey,
  inputTokenAmount: number,
  sourceWallet?: Keypair
) {
  const sourceWalletKey = sourceWallet ? sourceWallet.publicKey : ctx.wallet.publicKey;
  const tokenADecimal = pool.getTokenAInfo().decimals;
  const tokenBDecimal = pool.getTokenBInfo().decimals;
  const tickSpacing = pool.getData().tickSpacing;
  const lowerTick = PriceMath.priceToInitializableTickIndex(
    lowerPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing
  );
  const upperTick = PriceMath.priceToInitializableTickIndex(
    upperPrice,
    tokenADecimal,
    tokenBDecimal,
    tickSpacing
  );
  const quote = await increaseLiquidityQuoteByInputToken(
    inputTokenMint,
    new Decimal(inputTokenAmount),
    lowerTick,
    upperTick,
    Percentage.fromFraction(1, 100),
    pool
  );

  // [Action] Open Position (and increase L)
  const { positionMint, tx } = await pool.openPosition(
    lowerTick,
    upperTick,
    quote,
    sourceWalletKey,
    ctx.wallet.publicKey
  );

  if (sourceWallet) {
    tx.addSigner(sourceWallet);
  }

  await tx.buildAndExecute();

  return {
    positionMint,
    positionAddress: PDAUtil.getPosition(ctx.program.programId, positionMint),
  };
}

export async function generateDefaultOpenBundledPositionParams(
  context: WhirlpoolContext,
  whirlpool: PublicKey,
  positionBundleMint: PublicKey,
  bundleIndex: number,
  tickLowerIndex: number,
  tickUpperIndex: number,
  owner: PublicKey,
  funder?: PublicKey
): Promise<{ params: Required<OpenBundledPositionParams> }> {
  const bundledPositionPda = PDAUtil.getBundledPosition(context.program.programId, positionBundleMint, bundleIndex);
  const positionBundle = PDAUtil.getPositionBundle(context.program.programId, positionBundleMint).publicKey;

  const positionBundleTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    positionBundleMint,
    owner
  );

  const params: Required<OpenBundledPositionParams> = {
    bundleIndex,
    bundledPositionPda,
    positionBundle,
    positionBundleAuthority: owner,
    funder: funder || owner,
    positionBundleTokenAccount,
    whirlpool: whirlpool,
    tickLowerIndex,
    tickUpperIndex,
  };
  return {
    params,
  };
}
